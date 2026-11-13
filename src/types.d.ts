type Resource =
    | TextureResource
    | CubeTextureResource
    | ModelResource
    | AudioResource;

declare interface StyleSheetCSS {
    [key: string]: React.CSSProperties;
}

type TextureResource = {
    name: string;
    type: 'texture';
    path: string;
    /** Smaller variant used on small screens */
    pathSmall?: string;
};

type CubeTextureResource = {
    name: string;
    type: 'cubeTexture';
    path: string[];
};

type ModelResource = {
    name: string;
    type: 'gltfModel';
    path: string;
};

type AudioResource = {
    name: string;
    type: 'audio';
    path: string;
};

type EnclosingPlane = {
    size: THREE.Vector2;
    position: THREE.Vector3;
    rotation: THREE.Euler;
};

type CameraKeyframe = {
    position: THREE.Vector3;
    focalPoint: THREE.Vector3;
};

type LoadedResource =
    | LoadedTexture
    | LoadedCubeTexture
    | LoadedModel
    | LoadedAudio;

type LoadedTexture = THREE.Texture;

type LoadedModel = import('three/examples/jsm/loaders/GLTFLoader').GLTF;

type LoadedCubeTexture = THREE.CubeTexture;

type LoadedAudio = AudioBuffer;

type ResourceType = 'texture' | 'cubeTexture' | 'gltfModel' | 'audio';

declare module '*.glsl' {
    const source: string;
    export default source;
}

/** Fields the app attaches to DOM events forwarded from the monitor iframe */
interface MonitorEventFields {
    inComputer?: boolean;
    key?: string;
    clientX?: number;
    clientY?: number;
}

type MonitorMessageType =
    | 'mousemove'
    | 'mousedown'
    | 'mouseup'
    | 'keydown'
    | 'keyup';
