/** GLB source inspection through the Studio's existing renderer; no second WebGL context. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export class MeshView {
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(35,1,.01,100);
  readonly target=new THREE.Vector3(0,.75,0);
  private object:THREE.Group|null=null;
  private disposed=false;
  private masks:THREE.Texture[]=[];
  private teamColors=new Map<THREE.Material,THREE.Color>();
  async load(url:string){
    if(!url.startsWith("/api/art-review/file?"))throw Error("Source models are local only");
    const response=await fetch(url);if(!response.ok)throw Error(`Model unavailable (${response.status})`);
    const bytes=await response.arrayBuffer();if(bytes.byteLength>64*1024*1024)throw Error("Use an optimized GLB under 64 MB");
    const view=new DataView(bytes);if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67)throw Error("Invalid GLB");
    const length=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
    for(const item of [...(doc.buffers??[]),...(doc.images??[])])if(item.uri&&!item.uri.startsWith("data:"))throw Error("Source GLB must embed its textures and buffers");
    const gltf=await new GLTFLoader().parseAsync(bytes,"");this.object=gltf.scene;
    const materials:THREE.MeshStandardMaterial[]=[];gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial&&typeof m.userData.playerColorMaskTexture==="number")materials.push(m);});
    for(const material of materials){
      const mask=await gltf.parser.getDependency("texture",material.userData.playerColorMaskTexture) as THREE.Texture;mask.colorSpace=THREE.NoColorSpace;this.masks.push(mask);
      const color=new THREE.Color("#d54939");this.teamColors.set(material,color);
      material.onBeforeCompile=shader=>{shader.uniforms.uPlayerMask={value:mask};shader.uniforms.uPlayerColor={value:color};shader.fragmentShader="uniform sampler2D uPlayerMask; uniform vec3 uPlayerColor;\n"+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>","#include <map_fragment>\nfloat playerMask=texture2D(uPlayerMask,vMapUv).r; float paintShade=clamp(max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))*2.0,0.06,0.95); diffuseColor.rgb=mix(diffuseColor.rgb,uPlayerColor*paintShade,playerMask);");};
      material.customProgramCacheKey=()=>"rtsai-player-mask-v1";
    }
    if(this.disposed){this.dispose();return;}
    const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
    const longest=Math.max(size.x,size.y,size.z);if(!Number.isFinite(longest)||longest<=0)throw Error("Model has no visible geometry");
    const fit=2.4/longest,wrapper=new THREE.Group();wrapper.scale.setScalar(fit);wrapper.position.set(-centre.x*fit,-box.min.y*fit,-centre.z*fit);wrapper.add(gltf.scene);this.scene.add(wrapper);
    this.target.set(0,size.y*fit*.5,0);
    this.scene.add(new THREE.HemisphereLight(0xf3f2e6,0x252d24,2));
    const key=new THREE.DirectionalLight(0xfff5df,3.2);key.position.set(-3,5,4);this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xc4d6e2,.7);fill.position.set(3,1,-2);this.scene.add(fill);
    const grid=new THREE.GridHelper(6,12,0x565b46,0x29332b);this.scene.add(grid);
    this.reset();
  }
  reset(){this.camera.position.copy(this.target).add(new THREE.Vector3(3,2.1,4.2));this.camera.lookAt(this.target);}
  resize(width:number,height:number){this.camera.aspect=width/Math.max(1,height);this.camera.updateProjectionMatrix();}
  color(hex:string){this.object?.traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
    const maskColor=this.teamColors.get(m);if(maskColor){maskColor.set(hex);continue;}
    const index=m.userData.playerRemapPosition,length=m.userData.playerRemapLength;if(typeof index!=="number"||!(m instanceof THREE.MeshStandardMaterial))continue;
    const shade=.25+.75*(1-index/Math.max(1,length-1));m.color.set(hex).multiplyScalar(shade);
  }});}
  turret(degrees:number){this.object?.traverse(o=>{if(o.userData.independentTurret)o.rotation.y=degrees*Math.PI/180;});}
  wireframe(enabled:boolean){this.object?.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial)m.wireframe=enabled;});}
  dispose(){this.disposed=true;this.object?.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const v of Object.values(m))if(v instanceof THREE.Texture)v.dispose();m.dispose();}});this.masks.forEach(m=>m.dispose());this.masks=[];this.teamColors.clear();this.object=null;this.scene.clear();}
}
