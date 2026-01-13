import torch
import json

top10_activations = torch.load('top10_activations.pt', weights_only=False)

with open('IPR001478.json', 'r') as f:
    ipr_data = json.load(f)

def convert_to_json(obj):
    """Recursively convert PyTorch tensors and numpy arrays to JSON-serializable types."""
    if hasattr(obj, 'tolist'):  # tensor/ndarray
        return obj.tolist()
    if isinstance(obj, dict):
        return {str(k): convert_to_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [convert_to_json(x) for x in obj]
    return obj

# Build output structure
output = {
    "family": ipr_data["family"],
    "layers": {}
}

# Extract activations for each layer and latent
for layer, latent_ids in ipr_data['nodes'].items():
    output["layers"][layer] = {}
    for latent_id in latent_ids:
        activations = top10_activations['storage'][int(layer)][latent_id]
        output["layers"][layer][str(latent_id)] = convert_to_json(activations)

# Write output
with open('top_activations.json', 'w') as f:
    json.dump(output, f, indent=2)

print("Saved to top_activations.json")
