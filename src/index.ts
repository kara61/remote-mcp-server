import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// Define common schemas for reuse
const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const ColorSchema = z.union([
  z.string(), // CSS color or hex
  z.object({ r: z.number(), g: z.number(), b: z.number() }), // RGB object
]);

const MaterialTypeSchema = z.enum([
  "basic", "standard", "phong", "physical", "lambert", "normal", "depth", "toon"
]);

const MaterialPropertiesSchema = z.object({
  type: MaterialTypeSchema,
  color: ColorSchema.optional(),
  wireframe: z.boolean().optional(),
  transparent: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(1).optional(),
  emissive: ColorSchema.optional(),
  flatShading: z.boolean().optional(),
  side: z.enum(["front", "back", "double"]).optional(),
}).optional();

// Scene state management utility
const sceneStateUtil = `
// Scene state management utility for Three.js operations
class SceneState {
  static scenes = new Map();
  static activeSceneId = null;
  
  static getScene(sceneId) {
    if (!this.scenes.has(sceneId)) {
      throw new Error(\`Scene with ID \${sceneId} not found\`);
    }
    return this.scenes.get(sceneId);
  }
  
  static createScene(sceneId, initialObjects = {}) {
    if (this.scenes.has(sceneId)) {
      throw new Error(\`Scene with ID \${sceneId} already exists\`);
    }
    
    this.scenes.set(sceneId, {
      objects: initialObjects,
      cameras: {},
      activeCamera: null,
    });
    
    if (this.activeSceneId === null) {
      this.activeSceneId = sceneId;
    }
    
    return this.scenes.get(sceneId);
  }
  
  static getObject(sceneId, objectId) {
    const scene = this.getScene(sceneId);
    if (!scene.objects[objectId]) {
      throw new Error(\`Object with ID \${objectId} not found in scene \${sceneId}\`);
    }
    return scene.objects[objectId];
  }
  
  static setObject(sceneId, objectId, object) {
    const scene = this.getScene(sceneId);
    scene.objects[objectId] = object;
    return object;
  }
  
  static removeObject(sceneId, objectId) {
    const scene = this.getScene(sceneId);
    if (!scene.objects[objectId]) {
      throw new Error(\`Object with ID \${objectId} not found in scene \${sceneId}\`);
    }
    
    const object = scene.objects[objectId];
    delete scene.objects[objectId];
    return object;
  }
  
  static setActiveCamera(sceneId, cameraId) {
    const scene = this.getScene(sceneId);
    if (!scene.cameras[cameraId]) {
      throw new Error(\`Camera with ID \${cameraId} not found in scene \${sceneId}\`);
    }
    
    scene.activeCamera = cameraId;
    return scene.cameras[cameraId];
  }
  
  static getActiveCamera(sceneId) {
    const scene = this.getScene(sceneId);
    if (!scene.activeCamera) {
      return null;
    }
    return scene.cameras[scene.activeCamera];
  }
}
`;

export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Three.js MCP Server",
    version: "1.0.0",
  });

  async init() {
    // Original example tool
    this.server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));

    // Scene management tools
    this.server.tool("createScene", {
      sceneId: z.string(),
      backgroundColor: ColorSchema.optional(),
      ambientLightColor: ColorSchema.optional(),
      ambientLightIntensity: z.number().optional(),
    }, async ({ sceneId, backgroundColor, ambientLightColor, ambientLightIntensity }) => {
      const code = `
      ${sceneStateUtil}
      
      // Create new scene
      try {
        const scene = SceneState.createScene("${sceneId}");
        
        // Set scene properties
        ${backgroundColor ? `scene.backgroundColor = ${JSON.stringify(backgroundColor)};` : ''}
        ${ambientLightColor ? `
        scene.ambientLight = {
          color: ${JSON.stringify(ambientLightColor)},
          intensity: ${ambientLightIntensity || 1.0}
        };` : ''}
        
        return {
          success: true,
          sceneId: "${sceneId}",
          message: "Scene created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Scene "${sceneId}" created successfully.` 
        }],
        execution: { code, result: `Scene "${sceneId}" created successfully.` }
      };
    });

    // Geometry creation tools
    this.server.tool("createCube", {
      sceneId: z.string(),
      objectId: z.string(),
      width: z.number().default(1),
      height: z.number().default(1),
      depth: z.number().default(1),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      material: MaterialPropertiesSchema,
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, width, height, depth, position, rotation, scale, material, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create cube
        const cube = {
          type: "cube",
          geometry: {
            width: ${width},
            height: ${height},
            depth: ${depth}
          },
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${material ? `material: ${JSON.stringify(material)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: []
        };
        
        // Add to scene
        scene.objects["${objectId}"] = cube;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          geometry: "cube",
          message: "Cube created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Cube "${objectId}" created successfully in scene "${sceneId}".` 
        }],
        execution: { code, result: `Cube "${objectId}" created successfully` }
      };
    });

    this.server.tool("createSphere", {
      sceneId: z.string(),
      objectId: z.string(),
      radius: z.number().default(1),
      widthSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      material: MaterialPropertiesSchema,
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, radius, widthSegments, heightSegments, position, rotation, scale, material, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create sphere
        const sphere = {
          type: "sphere",
          geometry: {
            radius: ${radius},
            widthSegments: ${widthSegments || 32},
            heightSegments: ${heightSegments || 16}
          },
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${material ? `material: ${JSON.stringify(material)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: []
        };
        
        // Add to scene
        scene.objects["${objectId}"] = sphere;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          geometry: "sphere",
          message: "Sphere created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Sphere "${objectId}" created successfully in scene "${sceneId}".` 
        }],
        execution: { code, result: `Sphere "${objectId}" created successfully` }
      };
    });

    this.server.tool("createCylinder", {
      sceneId: z.string(),
      objectId: z.string(),
      radiusTop: z.number().default(1),
      radiusBottom: z.number().default(1),
      height: z.number().default(1),
      radialSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      openEnded: z.boolean().optional(),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      material: MaterialPropertiesSchema,
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, position, rotation, scale, material, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create cylinder
        const cylinder = {
          type: "cylinder",
          geometry: {
            radiusTop: ${radiusTop},
            radiusBottom: ${radiusBottom},
            height: ${height},
            radialSegments: ${radialSegments || 32},
            heightSegments: ${heightSegments || 1},
            openEnded: ${openEnded === true}
          },
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${material ? `material: ${JSON.stringify(material)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: []
        };
        
        // Add to scene
        scene.objects["${objectId}"] = cylinder;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          geometry: "cylinder",
          message: "Cylinder created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Cylinder "${objectId}" created successfully in scene "${sceneId}".` 
        }],
        execution: { code, result: `Cylinder "${objectId}" created successfully` }
      };
    });

    this.server.tool("createPlane", {
      sceneId: z.string(),
      objectId: z.string(),
      width: z.number().default(1),
      height: z.number().default(1),
      widthSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      material: MaterialPropertiesSchema,
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, width, height, widthSegments, heightSegments, position, rotation, scale, material, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create plane
        const plane = {
          type: "plane",
          geometry: {
            width: ${width},
            height: ${height},
            widthSegments: ${widthSegments || 1},
            heightSegments: ${heightSegments || 1}
          },
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${material ? `material: ${JSON.stringify(material)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: []
        };
        
        // Add to scene
        scene.objects["${objectId}"] = plane;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          geometry: "plane",
          message: "Plane created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Plane "${objectId}" created successfully in scene "${sceneId}".` 
        }],
        execution: { code, result: `Plane "${objectId}" created successfully` }
      };
    });

    // GLTF model loading
    this.server.tool("loadGLTFModel", {
      sceneId: z.string(),
      objectId: z.string(),
      url: z.string().url(),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, url, position, rotation, scale, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create GLTF model reference
        const model = {
          type: "gltfModel",
          url: "${url}",
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: []
        };
        
        // Add to scene
        scene.objects["${objectId}"] = model;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          type: "gltfModel",
          message: "GLTF model loaded successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `GLTF model "${objectId}" loaded from "${url}" in scene "${sceneId}".` 
        }],
        execution: { code, result: `GLTF model "${objectId}" loaded successfully` }
      };
    });

    // Object modification tools
    this.server.tool("setObjectTransform", {
      sceneId: z.string(),
      objectId: z.string(),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
    }, async (params) => {
      const { sceneId, objectId, position, rotation, scale } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const object = SceneState.getObject("${sceneId}", "${objectId}");
        
        // Update transformation properties
        ${position ? `object.position = ${JSON.stringify(position)};` : ''}
        ${rotation ? `object.rotation = ${JSON.stringify(rotation)};` : ''}
        ${scale ? `object.scale = ${JSON.stringify(scale)};` : ''}
        
        return {
          success: true,
          objectId: "${objectId}",
          message: "Object transform updated successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Object "${objectId}" transform updated in scene "${sceneId}".` 
        }],
        execution: { code, result: `Object "${objectId}" transform updated successfully` }
      };
    });

    this.server.tool("setObjectMaterial", {
      sceneId: z.string(),
      objectId: z.string(),
      material: MaterialPropertiesSchema,
    }, async (params) => {
      const { sceneId, objectId, material } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const object = SceneState.getObject("${sceneId}", "${objectId}");
        
        // Update material properties
        object.material = ${JSON.stringify(material)};
        
        return {
          success: true,
          objectId: "${objectId}",
          message: "Object material updated successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Object "${objectId}" material updated in scene "${sceneId}".` 
        }],
        execution: { code, result: `Object "${objectId}" material updated successfully` }
      };
    });

    // Object hierarchy management
    this.server.tool("setObjectParent", {
      sceneId: z.string(),
      objectId: z.string(),
      parentId: z.string().nullable(),
    }, async (params) => {
      const { sceneId, objectId, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        const object = SceneState.getObject("${sceneId}", "${objectId}");
        
        // Remove from current parent's children if exists
        if (object.parent) {
          const currentParent = SceneState.getObject("${sceneId}", object.parent);
          if (currentParent.children) {
            currentParent.children = currentParent.children.filter(id => id !== "${objectId}");
          }
        }
        
        // Set new parent
        if (${parentId === null ? 'false' : 'true'}) {
          const newParent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!newParent.children) newParent.children = [];
          newParent.children.push("${objectId}");
          object.parent = "${parentId}";
        } else {
          delete object.parent;
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          parentId: ${parentId === null ? 'null' : `"${parentId}"`},
          message: "Object parent updated successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: parentId === null 
            ? `Object "${objectId}" detached from parent in scene "${sceneId}".`
            : `Object "${objectId}" attached to parent "${parentId}" in scene "${sceneId}".` 
        }],
        execution: { code, result: `Object "${objectId}" parent updated successfully` }
      };
    });

    // Object deletion
    this.server.tool("deleteObject", {
      sceneId: z.string(),
      objectId: z.string(),
      recursive: z.boolean().default(true),
    }, async (params) => {
      const { sceneId, objectId, recursive } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        const object = SceneState.getObject("${sceneId}", "${objectId}");
        
        // Recursive deletion function
        function deleteObjectAndChildren(id) {
          const obj = scene.objects[id];
          
          // Remove from parent's children if exists
          if (obj.parent) {
            const parent = scene.objects[obj.parent];
            if (parent && parent.children) {
              parent.children = parent.children.filter(childId => childId !== id);
            }
          }
          
          // Delete children if recursive
          if (${recursive} && obj.children && obj.children.length > 0) {
            [...obj.children].forEach(childId => {
              deleteObjectAndChildren(childId);
            });
          } else if (obj.children && obj.children.length > 0) {
            // Reparent children to object's parent or to scene root
            obj.children.forEach(childId => {
              const child = scene.objects[childId];
              child.parent = obj.parent || null;
              
              if (obj.parent) {
                const parent = scene.objects[obj.parent];
                if (!parent.children) parent.children = [];
                parent.children.push(childId);
              }
            });
          }
          
          // Delete the object itself
          delete scene.objects[id];
        }
        
        // Execute deletion
        deleteObjectAndChildren("${objectId}");
        
        return {
          success: true,
          objectId: "${objectId}",
          recursive: ${recursive},
          message: "Object deleted successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Object "${objectId}" ${recursive ? "and its children " : ""}deleted from scene "${sceneId}".` 
        }],
        execution: { code, result: `Object "${objectId}" deleted successfully` }
      };
    });

    // Camera management
    this.server.tool("createCamera", {
      sceneId: z.string(),
      cameraId: z.string(),
      type: z.enum(["perspective", "orthographic"]),
      position: Vector3Schema.optional(),
      lookAt: Vector3Schema.optional(),
      fov: z.number().optional(),
      near: z.number().optional(),
      far: z.number().optional(),
      parentId: z.string().optional(),
      setAsActive: z.boolean().default(false),
    }, async (params) => {
      const { sceneId, cameraId, type, position, lookAt, fov, near, far, parentId, setAsActive } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create camera
        const camera = {
          type: "camera",
          cameraType: "${type}",
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${lookAt ? `lookAt: ${JSON.stringify(lookAt)},` : ''}
          ${fov !== undefined ? `fov: ${fov},` : ''}
          ${near !== undefined ? `near: ${near},` : ''}
          ${far !== undefined ? `far: ${far},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
        };
        
        // Add to scene cameras
        scene.cameras["${cameraId}"] = camera;
        
        // Add to scene objects as well
        scene.objects["${cameraId}"] = camera;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${cameraId}");
        }
        
        // Set as active camera if requested
        if (${setAsActive}) {
          scene.activeCamera = "${cameraId}";
        }
        
        return {
          success: true,
          cameraId: "${cameraId}",
          type: "${type}",
          isActive: ${setAsActive},
          message: "Camera created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `${type.charAt(0).toUpperCase() + type.slice(1)} camera "${cameraId}" created in scene "${sceneId}"${setAsActive ? " and set as active" : ""}.` 
        }],
        execution: { code, result: `Camera "${cameraId}" created successfully` }
      };
    });

    this.server.tool("setActiveCamera", {
      sceneId: z.string(),
      cameraId: z.string(),
    }, async (params) => {
      const { sceneId, cameraId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Check if camera exists
        if (!scene.cameras["${cameraId}"]) {
          throw new Error(\`Camera with ID ${cameraId} not found in scene ${sceneId}\`);
        }
        
        // Set active camera
        scene.activeCamera = "${cameraId}";
        
        return {
          success: true,
          cameraId: "${cameraId}",
          message: "Active camera set successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Camera "${cameraId}" set as active in scene "${sceneId}".` 
        }],
        execution: { code, result: `Camera "${cameraId}" set as active` }
      };
    });

    // Complex geometry creation
    this.server.tool("createCompoundObject", {
      sceneId: z.string(),
      objectId: z.string(),
      components: z.array(z.object({
        type: z.enum(["cube", "sphere", "cylinder", "plane"]),
        position: Vector3Schema.optional(),
        rotation: Vector3Schema.optional(),
        scale: Vector3Schema.optional(),
        material: MaterialPropertiesSchema,
        geometry: z.record(z.string(), z.any()).optional(),
      })),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, components, position, rotation, scale, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create compound object (group)
        const group = {
          type: "group",
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: [],
          components: ${JSON.stringify(components)}
        };
        
        // Add to scene
        scene.objects["${objectId}"] = group;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          type: "group",
          componentsCount: ${components.length},
          message: "Compound object created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Compound object "${objectId}" with ${components.length} components created in scene "${sceneId}".` 
        }],
        execution: { code, result: `Compound object "${objectId}" created successfully` }
      };
    });

    // Scene query tool
    this.server.tool("getSceneInfo", {
      sceneId: z.string(),
      includeObjects: z.boolean().default(true),
      includeCameras: z.boolean().default(true),
    }, async (params) => {
      const { sceneId, includeObjects, includeCameras } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Build scene info
        const sceneInfo = {
          id: "${sceneId}",
          activeCamera: scene.activeCamera,
          objectCount: Object.keys(scene.objects).length,
          cameraCount: Object.keys(scene.cameras).length,
        };
        
        // Include objects if requested
        if (${includeObjects}) {
          sceneInfo.objects = scene.objects;
        }
        
        // Include cameras if requested
        if (${includeCameras}) {
          sceneInfo.cameras = scene.cameras;
        }
        
        return {
          success: true,
          sceneInfo: sceneInfo,
          message: "Scene info retrieved successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Scene information retrieved for "${sceneId}".` 
        }],
        execution: { code, result: `Scene info retrieved successfully for "${sceneId}"` }
      };
    });

    // Advanced material tools
    this.server.tool("createTextureMaterial", {
      sceneId: z.string(),
      materialId: z.string(),
      type: MaterialTypeSchema,
      textureUrl: z.string().url(),
      normalMapUrl: z.string().url().optional(),
      bumpMapUrl: z.string().url().optional(),
      roughnessMapUrl: z.string().url().optional(),
      metalnessMapUrl: z.string().url().optional(),
      emissiveMapUrl: z.string().url().optional(),
      properties: z.record(z.string(), z.any()).optional(),
    }, async (params) => {
      const { sceneId, materialId, type, textureUrl, normalMapUrl, bumpMapUrl, roughnessMapUrl, metalnessMapUrl, emissiveMapUrl, properties } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Check if materials collection exists
        if (!scene.materials) {
          scene.materials = {};
        }
        
        // Create material
        const material = {
          type: "${type}",
          textureUrl: "${textureUrl}",
          ${normalMapUrl ? `normalMapUrl: "${normalMapUrl}",` : ''}
          ${bumpMapUrl ? `bumpMapUrl: "${bumpMapUrl}",` : ''}
          ${roughnessMapUrl ? `roughnessMapUrl: "${roughnessMapUrl}",` : ''}
          ${metalnessMapUrl ? `metalnessMapUrl: "${metalnessMapUrl}",` : ''}
          ${emissiveMapUrl ? `emissiveMapUrl: "${emissiveMapUrl}",` : ''}
          ${properties ? `properties: ${JSON.stringify(properties)},` : ''}
        };
        
        // Add to scene materials
        scene.materials["${materialId}"] = material;
        
        return {
          success: true,
          materialId: "${materialId}",
          type: "${type}",
          message: "Texture material created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Texture material "${materialId}" created in scene "${sceneId}".` 
        }],
        execution: { code, result: `Texture material "${materialId}" created successfully` }
      };
    });

    this.server.tool("applyMaterialToObject", {
      sceneId: z.string(),
      objectId: z.string(),
      materialId: z.string(),
    }, async (params) => {
      const { sceneId, objectId, materialId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        const object = SceneState.getObject("${sceneId}", "${objectId}");
        
        // Check if material exists
        if (!scene.materials || !scene.materials["${materialId}"]) {
          throw new Error(\`Material with ID ${materialId} not found in scene ${sceneId}\`);
        }
        
        // Apply material to object
        object.materialId = "${materialId}";
        
        return {
          success: true,
          objectId: "${objectId}",
          materialId: "${materialId}",
          message: "Material applied to object successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Material "${materialId}" applied to object "${objectId}" in scene "${sceneId}".` 
        }],
        execution: { code, result: `Material "${materialId}" applied to object "${objectId}" successfully` }
      };
    });

    // Complex geometry tool for generating parametric shapes
    this.server.tool("createParametricGeometry", {
      sceneId: z.string(),
      objectId: z.string(),
      equation: z.string(),  // Mathematical equation for parametric surface
      uSegments: z.number().default(32),
      vSegments: z.number().default(32),
      uRange: z.tuple([z.number(), z.number()]).default([0, 1]),
      vRange: z.tuple([z.number(), z.number()]).default([0, 1]),
      position: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      scale: Vector3Schema.optional(),
      material: MaterialPropertiesSchema,
      parentId: z.string().optional(),
    }, async (params) => {
      const { sceneId, objectId, equation, uSegments, vSegments, uRange, vRange, position, rotation, scale, material, parentId } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Create parametric geometry
        const parametricGeometry = {
          type: "parametric",
          equation: \`${equation}\`,
          uSegments: ${uSegments},
          vSegments: ${vSegments},
          uRange: [${uRange[0]}, ${uRange[1]}],
          vRange: [${vRange[0]}, ${vRange[1]}],
          ${position ? `position: ${JSON.stringify(position)},` : ''}
          ${rotation ? `rotation: ${JSON.stringify(rotation)},` : ''}
          ${scale ? `scale: ${JSON.stringify(scale)},` : ''}
          ${material ? `material: ${JSON.stringify(material)},` : ''}
          ${parentId ? `parent: "${parentId}",` : ''}
          children: []
        };
        
        // Add to scene
        scene.objects["${objectId}"] = parametricGeometry;
        
        // Add to parent if specified
        if (${parentId ? 'true' : 'false'}) {
          const parent = SceneState.getObject("${sceneId}", "${parentId}");
          if (!parent.children) parent.children = [];
          parent.children.push("${objectId}");
        }
        
        return {
          success: true,
          objectId: "${objectId}",
          type: "parametric",
          message: "Parametric geometry created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Parametric geometry "${objectId}" created in scene "${sceneId}" with equation: ${equation}` 
        }],
        execution: { code, result: `Parametric geometry "${objectId}" created successfully` }
      };
    });
    
    // Animation framework
    this.server.tool("createAnimation", {
      sceneId: z.string(),
      animationId: z.string(),
      targetId: z.string(),
      property: z.enum(["position", "rotation", "scale", "color", "opacity"]),
      keyframes: z.array(z.object({
        time: z.number(),
        value: z.any(),
        easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "bounce"]).optional(),
      })),
      duration: z.number().default(1),
      loop: z.boolean().default(false),
    }, async (params) => {
      const { sceneId, animationId, targetId, property, keyframes, duration, loop } = params;
      
      const code = `
      ${sceneStateUtil}
      
      try {
        const scene = SceneState.getScene("${sceneId}");
        
        // Check if target object exists
        SceneState.getObject("${sceneId}", "${targetId}");
        
        // Check if animations collection exists
        if (!scene.animations) {
          scene.animations = {};
        }
        
        // Create animation
        const animation = {
          targetId: "${targetId}",
          property: "${property}",
          keyframes: ${JSON.stringify(keyframes)},
          duration: ${duration},
          loop: ${loop}
        };
        
        // Add to scene animations
        scene.animations["${animationId}"] = animation;
        
        return {
          success: true,
          animationId: "${animationId}",
          targetId: "${targetId}",
          property: "${property}",
          message: "Animation created successfully"
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
      `;
      
      return {
        content: [{ 
          type: "text", 
          text: `Animation "${animationId}" created for ${property} of object "${targetId}" in scene "${sceneId}".` 
        }],
        execution: { code, result: `Animation "${animationId}" created successfully` }
      };
    });
  }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
  apiRoute: "/sse",
  // TODO: fix these types
  // @ts-ignore
  apiHandler: MyMCP.mount("/sse"),
  // @ts-ignore
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
