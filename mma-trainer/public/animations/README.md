# 3D Animations Directory

This directory contains all 3D animation assets for the MMA training application.

## Folder Structure

### `/techniques`

Contains animation files for different MMA techniques:

- **Punches**: Jab, Cross, Hook, Uppercut, etc.
- **Kicks**: Front kick, Roundhouse, Side kick, etc.
- **Grappling**: Takedowns, submissions, etc.
- **Defense**: Blocks, dodges, parries, etc.

**Naming Convention**: `{technique-name}_{variation}.{ext}`

- Example: `jab_straight.glb`, `roundhouse_kick_right.glb`

### `/characters`

Contains character models and their animations:

- Base character models
- Idle animations
- Movement animations (walking, running)
- Character-specific technique animations

**Naming Convention**: `{character-name}_{animation-type}.{ext}`

- Example: `fighter_idle.glb`, `fighter_walk.glb`

### `/environments`

Contains 3D environment/scene assets:

- Training room setups
- Background elements
- Props and equipment

**Naming Convention**: `{environment-name}.{ext}`

- Example: `training_room.glb`, `gym_floor.glb`

### `/reference`

Contains reference animations for comparison:

- Professional technique demonstrations
- Ideal form examples
- Slow-motion reference clips

**Naming Convention**: `{technique}_reference_{angle}.{ext}`

- Example: `jab_reference_front.glb`, `roundhouse_reference_side.glb`

### `/ui`

Contains 3D UI elements and overlays:

- 3D feedback markers
- Visual indicators
- UI decorations

**Naming Convention**: `{element-name}.{ext}`

- Example: `feedback_marker.glb`, `score_indicator.glb`

## Supported File Formats

- **GLB** (recommended): Binary GLTF format, optimized for web
- **GLTF**: JSON-based format, human-readable
- **FBX**: If needed for import/conversion
- **OBJ**: For simple models

## Usage in Code

Animations should be loaded from the `/public` folder using relative paths:

```typescript
// Example: Loading a technique animation
const animationPath = "/animations/techniques/jab_straight.glb";

// In Babylon.js
import { SceneLoader } from "@babylonjs/core";
SceneLoader.ImportMesh("", animationPath, "", scene);
```

## Best Practices

1. **Optimize files**: Use compressed formats (GLB) when possible
2. **Naming**: Use descriptive, consistent naming conventions
3. **Organization**: Keep related animations in appropriate folders
4. **Documentation**: Update this README when adding new categories
5. **Version control**: Consider using Git LFS for large animation files

## File Size Guidelines

- Individual technique animations: < 5MB
- Character models: < 10MB
- Environment assets: < 20MB
- Total project size: Monitor and optimize as needed
