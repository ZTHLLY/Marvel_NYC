import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Static posing of a rigged mannequin (Mixamo "X Bot", see docs/asset-sources.md).
 * Poses are authored as world-space *directions* per limb segment ("aim"), which is far more
 * readable than raw joint quaternions and independent of the rig's local bone axes.
 * No animation system is involved: the pose is baked once and never changes.
 */
const CHILD: Record<string, string> = {
  Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

let basePromise: Promise<THREE.Group> | null = null;
const loadBase = () => (basePromise ??= new GLTFLoader().loadAsync('./models/Xbot.glb').then((g) => g.scene));

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qd = new THREE.Quaternion();

export class Mannequin {
  readonly root: THREE.Group;
  readonly bones: Record<string, THREE.Bone> = {};
  readonly meshes: THREE.SkinnedMesh[] = [];
  private palmSign: Record<string, number> = {};

  private constructor(root: THREE.Group) {
    this.root = root;
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name.replace(/^mixamorig:?/, '')] = o as THREE.Bone;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.meshes.push(o as THREE.SkinnedMesh);
    });
    root.updateMatrixWorld(true);
    for (const s of ['Left', 'Right']) this.palmSign[s] = this.rawPalm(s).y < 0 ? 1 : -1;   // palms face down in the T-pose
  }

  static async create(): Promise<Mannequin> {
    const base = await loadBase();
    return new Mannequin(SkeletonUtils.clone(base) as THREE.Group);
  }

  setMaterial(mat: THREE.Material) {
    for (const m of this.meshes) { m.material = mat; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
  }

  pos(name: string, out = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.bones[name].getWorldPosition(out); }

  /** Point a limb segment along a direction given in the character's own space (+Z forward, +X = its left, +Y up). */
  aim(name: string, x: number, y: number, z: number): this {
    const bone = this.bones[name], child = this.bones[CHILD[name]];
    this.root.updateMatrixWorld(true);
    const cur = child.getWorldPosition(v2).sub(bone.getWorldPosition(v1)).normalize();
    qd.setFromUnitVectors(cur, v1.set(x, y, z).normalize());
    this.applyWorld(bone, qd);
    return this;
  }
  /** Rotate a bone about an axis in character space (radians). */
  twist(name: string, ax: number, ay: number, az: number, angle: number): this {
    this.root.updateMatrixWorld(true);
    qd.setFromAxisAngle(v1.set(ax, ay, az).normalize(), angle);
    this.applyWorld(this.bones[name], qd);
    return this;
  }
  /** Rotate a bone around its own length (elbow / knee roll). */
  roll(name: string, angle: number): this {
    const bone = this.bones[name], child = this.bones[CHILD[name]];
    this.root.updateMatrixWorld(true);
    const axis = child.getWorldPosition(v2).sub(bone.getWorldPosition(v1)).normalize();
    qd.setFromAxisAngle(axis, angle);
    this.applyWorld(bone, qd);
    return this;
  }
  private applyWorld(bone: THREE.Bone, delta: THREE.Quaternion) {
    bone.getWorldQuaternion(q1);
    bone.parent!.getWorldQuaternion(q2);
    bone.quaternion.copy(q2.invert().multiply(delta.clone().multiply(q1)));
    bone.updateMatrixWorld(true);
  }
  /** Hips height (metres) and offset; the rest of the body follows. */
  hips(x: number, y: number, z: number): this { this.bones.Hips.position.set(x * 100, y * 100, z * 100); return this; }

  private rawPalm(side: string) {
    this.root.updateMatrixWorld(true);
    const h = this.bones[side + 'Hand'].getWorldPosition(new THREE.Vector3());
    const a = this.bones[side + 'HandIndex1'].getWorldPosition(new THREE.Vector3()).sub(h);
    const b = this.bones[side + 'HandPinky1'].getWorldPosition(new THREE.Vector3()).sub(h);
    return a.cross(b).normalize();
  }
  /** Unit vector pointing out of the palm. */
  palm(side: 'Left' | 'Right') { return this.rawPalm(side).multiplyScalar(this.palmSign[side]); }

  /** Curl the four fingers toward the palm by `deg` per joint (thumb follows loosely). */
  curl(side: 'Left' | 'Right', deg: number, spread = 0): this {
    const n = this.palm(side);
    FINGERS.forEach((f, fi) => {
      let acc = 0;
      for (let k = 1; k <= 3; k++) {
        const bone = this.bones[`${side}Hand${f}${k}`], child = this.bones[`${side}Hand${f}${k + 1}`];
        if (!bone || !child) continue;
        this.root.updateMatrixWorld(true);
        const cur = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
        acc = (deg * Math.PI) / 180 * (k === 1 ? 0.8 : 1) * (1 + spread * (fi - 1.5) * 0.12);
        // rotate toward the palm normal about the axis perpendicular to both
        const axis = new THREE.Vector3().crossVectors(cur, n).normalize();
        qd.setFromAxisAngle(axis, acc);
        this.applyWorld(bone, qd);
      }
    });
    const t1 = this.bones[`${side}HandThumb2`];
    if (t1) { const c = this.bones[`${side}HandThumb3`]; this.root.updateMatrixWorld(true); const cur = c.getWorldPosition(new THREE.Vector3()).sub(t1.getWorldPosition(new THREE.Vector3())).normalize(); qd.setFromAxisAngle(new THREE.Vector3().crossVectors(cur, n).normalize(), (deg * 0.5 * Math.PI) / 180); this.applyWorld(t1, qd); }
    return this;
  }

  /** Lowest point of the posed feet/hands in character space — used to seat the figure on its support. */
  finish() {
    this.root.updateMatrixWorld(true);
    for (const m of this.meshes) m.skeleton.update();
  }
}
