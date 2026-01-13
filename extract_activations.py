import math
import numpy as np

data = np.load('positives_IPR000786.npz', allow_pickle=True)
print("Arrays in file:", list(data.keys()))
for key in data.keys():
    print(f"  {key}: shape={data[key].shape}, dtype={data[key].dtype}")


import json

with open('IPR001478.json', 'r') as f:
    ipr_data = json.load(f)
feature_nodes = ipr_data['nodes']

sequence = data['sequences'][0]
activation = data['activations'][0]  # Dim: (Layers, Seq_Len, Latent_Size)

# Store tuples: (layer, seq_pos, activation_value, latent_index)
# Select features specified in IPR001478.json per layer
activations_list = []
for layer_idx in range(activation.shape[0]):
    layer_key = str(layer_idx)
    if layer_key not in feature_nodes:
        continue
    selected_indices = feature_nodes[layer_key]
    for seq_idx in range(activation.shape[1]):
        values = activation[layer_idx, seq_idx]
        for latent_idx in selected_indices:
            value = float(values[latent_idx])
            if math.fabs(value) > 0:
                activations_list.append([layer_idx, seq_idx, value, int(latent_idx)])

# Save as JSON
with open('activation_indices.json', 'w') as f:
    json.dump(activations_list, f)
print(sequence)

print(f"Saved {len(activations_list)} activations to activation_indices.json")
print(f"Format: [layer, seq_pos, activation_value, latent_index]")