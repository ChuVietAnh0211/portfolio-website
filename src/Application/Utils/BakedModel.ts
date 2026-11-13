import * as THREE from 'three';
import Application from '../Application';

const MOBILE_TEXTURE_SIZE = 2048;

export default class BakedModel {
    model: LoadedModel;
    texture: LoadedTexture;
    material: THREE.MeshBasicMaterial;

    constructor(model: LoadedModel, texture: LoadedTexture, scale?: number) {
        this.model = model;
        this.texture = texture;

        const renderer = new Application().renderer.instance;
        const caps = renderer.capabilities;

        this.texture.flipY = false;
        this.texture.encoding = THREE.sRGBEncoding;
        this.texture.anisotropy = Math.min(8, caps.getMaxAnisotropy());

        if (caps.maxTextureSize < 4096) {
            this.downscaleTexture(MOBILE_TEXTURE_SIZE);
        }
        this.texture.needsUpdate = true;

        this.material = new THREE.MeshBasicMaterial({
            map: this.texture,
        });

        this.model.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (scale) child.scale.set(scale, scale, scale);
                const original = child.material as
                    | THREE.Material
                    | THREE.Material[];
                child.material = this.material;
                if (Array.isArray(original)) {
                    original.forEach((m) => m.dispose());
                } else if (original !== this.material) {
                    original.dispose();
                }
            }
        });

        return this;
    }

    /** Shrink the decoded image before its first GPU upload. */
    private downscaleTexture(maxSize: number) {
        const image = this.texture.image as
            | (CanvasImageSource & { width: number; height: number })
            | undefined;
        if (!image || Math.max(image.width, image.height) <= maxSize) return;

        const ratio = maxSize / Math.max(image.width, image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        this.texture.image = canvas;
    }

    getModel(): THREE.Group {
        return this.model.scene;
    }
}
