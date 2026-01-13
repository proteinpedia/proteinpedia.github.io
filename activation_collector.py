"""
Collects CLT latent activations for specific InterPro families.

Output Format: .npz files containing:
  - 'activations': A NumPy object array of shape (N_SEQS,). 
                   Each element is a float32 array of shape (N_LAYERS, SEQ_LEN, D_HIDDEN).
  - 'entries': Array of UniProt Entry IDs.
  - 'sequences': Array of protein sequences.

Note: No max-pooling or mean-pooling is applied. Full latent sequences are saved.
"""

import sys
import os
import numpy as np
import polars as pl
import torch
import click
from tqdm import tqdm

# Ensure we can import from interprot
sys.path.append(os.path.join(os.path.dirname(__file__), "../.."))

from clt_module import CLTLightningModule
from sae_module import get_esm_model

def get_latents_for_batch(clt, esm_model, batch_seqs, device, k_value):
    """
    Runs inference and returns full latents for all layers.
    Returns: List of numpy arrays [ (Layers, Seq_Len_1, D_Hidden), (Layers, Seq_Len_2, D_Hidden), ... ]
    """
    n_layers = clt.num_layers
    batch_size = len(batch_seqs)
    
    # We can't pre-allocate a rectangular tensor because sequence lengths vary within the batch
    # We will collect layer outputs in a list first: [Layer0, Layer1, ...] 
    # where LayerX is (Batch, Max_Seq_Len, D_Hidden)
    layers_data = []

    with torch.no_grad():
        # 1. Prepare Batch Input
        data = [("protein", seq) for seq in batch_seqs]
        _, _, batch_tokens = esm_model.alphabet.get_batch_converter()(data)
        batch_tokens = batch_tokens.to(device)
        padding_mask = batch_tokens != esm_model.padding_idx # (B, T)

        # 2. Run ESM Encoder
        x = esm_model.embed_scale * esm_model.embed_tokens(batch_tokens)
        x = x.transpose(0, 1) # (T, B, E)
        
        # 3. Iterate Layers
        for layer_idx, layer in enumerate(esm_model.layers):
            if layer_idx >= n_layers: break

            # ESM Layer Forward
            x, _ = layer(x, self_attn_padding_mask=None, need_head_weights=False)
            
            # Prepare for CLT (B, T, E)
            layer_acts = x.transpose(0, 1) 
            
            # CLT Forward (Encode & Activate)
            # 1. Norm
            x_l, _, _ = clt.LN(layer_acts)
            x_l = x_l - clt.b_pre[layer_idx]
            
            # 2. Encoder
            pre_acts = clt.encoders[layer_idx](x_l) + clt.b_enc[layer_idx]
            
            # 3. Activation (The "Latents")
            latents = clt.topK_activation(pre_acts, k=k_value) # (B, T, D_Hidden)
            
            # Move to CPU immediately to save GPU memory
            layers_data.append(latents.cpu())

    # 4. Re-assemble into per-sequence arrays
    # layers_data is List[Tensor(B, T, H)] of length L
    
    batch_results = []
    
    for b_idx in range(batch_size):
        # Determine valid sequence length for this protein
        # esm_wrapper typically adds BOS and EOS. 
        # If you want the core sequence (without BOS/EOS), use [1 : length-1]
        # If you want full context, use [0 : length]
        # Here we take the core sequence matching the input string length
        seq_len = len(batch_seqs[b_idx])
        
        # Note: batch_tokens has BOS at 0 and EOS at seq_len+1 (usually)
        # We assume latents map 1:1 to tokens.
        # Extracting indices 1 to seq_len+1 gives the residues.
        start_idx = 1
        end_idx = start_idx + seq_len
        
        # Stack layers for this sequence: (L, Seq_Len, H)
        # layer_tensors[b_idx] is (T, H)
        seq_layers = []
        for l_idx in range(len(layers_data)):
            # Slice the valid tokens
            layer_act = layers_data[l_idx][b_idx, start_idx:end_idx, :]
            seq_layers.append(layer_act)
            
        # Stack to (L, Seq_Len, H)
        # Use float32 to save space if it was float64, but torch is usually float32/16
        seq_array = torch.stack(seq_layers, dim=0).float().numpy()
        batch_results.append(seq_array)
            
    return batch_results

@click.command()
@click.option("--clt-checkpoint", default="/usr/scratch/dtsui/CLT/interprot/interprot/results_clt_L6_dim5000_k128/checkpoints/clt-step=16000-val/loss=0.69.ckpt", type=click.Path(exists=True))
@click.option("--esm2-weight",  default="/usr/scratch/dtsui/CLT/interprot/interprot/esm2_t6_8M_UR50D.pt", type=click.Path(exists=True))
@click.option("--parquet-path",default="/usr/scratch/dtsui/CLT/ESM-CLT_base/nodes/data/swissprot_seqid30_75k_all_info_with_3di.parquet", type=click.Path(exists=True))
@click.option("--output-dir", default="./activations_output")
@click.option("--n-samples", default=50, help="Number of sequences to sample per group")
@click.option("--device", default="cuda")
def main(clt_checkpoint, esm2_weight, parquet_path, output_dir, n_samples, device):
    
    os.makedirs(output_dir, exist_ok=True)
    
    # --- 1. Load Data ---
    print(f"Loading data from {parquet_path}...")
    df = pl.read_parquet(parquet_path)
    
    if "InterPro" not in df.columns:
        raise ValueError("Parquet file missing 'InterPro' column")
        
    # Define targets (list of IDs to check)
    target_ids = ["IPR000786", "IPR011584"]
    
    # --- 2. Load Models ---
    print("Loading models...")
    module = CLTLightningModule.load_from_checkpoint(clt_checkpoint, map_location=device)
    module.to(device)
    module.eval()
    
    esm_model = get_esm_model(module.clt.d_model, module.alphabet, esm2_weight)
    esm_model = esm_model.to(device)
    esm_model.eval()
    
    # --- 3. Process Each Target ID ---
    
    for target_id in target_ids:
        print(f"\n--- Processing Target: {target_id} ---")
        
        # Filter Logic
        has_id = df["InterPro"].str.contains(target_id).fill_null(False)
        
        group_in = df.filter(has_id)
        group_out = df.filter(~has_id)
        
        print(f"Found {len(group_in)} sequences WITH {target_id}")
        print(f"Found {len(group_out)} sequences WITHOUT {target_id}")
        
        if len(group_in) == 0:
            print(f"Skipping {target_id} (no matches found)")
            continue

        # Handle cases with fewer samples than requested
        n_in = min(len(group_in), n_samples)
        n_out = min(len(group_out), n_samples)
        
        # Sample with shuffling
        df_in = group_in.sample(n=n_in, shuffle=True, seed=42)
        df_out = group_out.sample(n=n_out, shuffle=True, seed=42)
    
        # Process both Positive and Negative groups for this target
        for name, dataframe in [("positives", df_in), ("negatives", df_out)]:
            print(f"Processing {name} for {target_id} ({len(dataframe)} sequences)...")
            
            seqs = dataframe["Sequence"].to_list()
            entries = dataframe["Entry"].to_list()
            
            batch_size = 8 
            all_latents_list = []
            
            for i in tqdm(range(0, len(seqs), batch_size)):
                batch = seqs[i : i + batch_size]
                # Returns list of numpy arrays (L, T, H)
                batch_results = get_latents_for_batch(module.clt, esm_model, batch, device, module.clt.k)
                all_latents_list.extend(batch_results)
                
            # Fix for "could not broadcast" error:
            # Explicitly create an object array of the correct size first, then fill it.
            # This prevents NumPy from trying to be smart and creating a multidimensional array if shapes happen to align.
            activations_obj = np.empty(len(all_latents_list), dtype=object)
            for i, arr in enumerate(all_latents_list):
                activations_obj[i] = arr
            
            out_file = os.path.join(output_dir, f"{name}_{target_id}.npz")
            
            np.savez_compressed(
                out_file, 
                activations=activations_obj, 
                entries=entries,
                sequences=seqs
            )
            print(f"Saved to {out_file}")
            if len(activations_obj) > 0:
                print(f" - Example item shape: {activations_obj[0].shape} (Layers, Seq_Len, Hidden)")

if __name__ == "__main__":
    main()