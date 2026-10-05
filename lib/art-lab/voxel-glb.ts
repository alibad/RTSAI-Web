/** CPU-only lossless exposed-voxel geometry export. Artwork is still subject to its source rights. */
import * as THREE from "three";
import type { VxlLimb } from "./vxl";
const faces=[
  {d:[1,0,0],c:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]},
  {d:[-1,0,0],c:[[0,1,0],[0,0,0],[0,0,1],[0,1,1]]},
  {d:[0,1,0],c:[[1,1,0],[0,1,0],[0,1,1],[1,1,1]]},
  {d:[0,-1,0],c:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
  {d:[0,0,1],c:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]},
  {d:[0,0,-1],c:[[0,1,0],[1,1,0],[1,0,0],[0,0,0]]},
];
export function voxelGlbGeometry(limb:VxlLimb,palette:Uint8Array|Uint8ClampedArray,remap:number[]) {
  const [sx,sy,sz]=limb.size,groups=new Map<number,{p:number[];n:number[];c:number[];i:number[]}>(),remapped=new Set(remap);
  const filled=(x:number,y:number,z:number)=>x>=0&&y>=0&&z>=0&&x<sx&&y<sy&&z<sz&&limb.filled[x+sx*(y+sy*z)];
  for(let z=0;z<sz;z++)for(let y=0;y<sy;y++)for(let x=0;x<sx;x++){
    const index=x+sx*(y+sy*z);if(!limb.filled[index])continue;
    const color=limb.colors[index],key=remapped.has(color)?color:-1;
    let group=groups.get(key);if(!group){group={p:[],n:[],c:[],i:[]};groups.set(key,group);}
    for(const f of faces){if(filled(x+f.d[0],y+f.d[1],z+f.d[2]))continue;
      const base=group.p.length/3;
      for(const c of f.c){group.p.push(x+c[0],y+c[1],z+c[2]);group.n.push(...f.d);
        if(key===-1){const rgb=new THREE.Color().setRGB(palette[color*4]/255,palette[color*4+1]/255,palette[color*4+2]/255,THREE.SRGBColorSpace);group.c.push(rgb.r,rgb.g,rgb.b);}
      }group.i.push(base,base+1,base+2,base,base+2,base+3);
    }
  }
  return [...groups].filter(([,g])=>g.i.length).map(([key,g])=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(g.p,3));geometry.setAttribute("normal",new THREE.Float32BufferAttribute(g.n,3));geometry.setIndex(g.i);
    if(key===-1)geometry.setAttribute("color",new THREE.Float32BufferAttribute(g.c,3));
    const material=new THREE.MeshStandardMaterial({vertexColors:key===-1,roughness:.8,metalness:0,side:THREE.DoubleSide});
    material.name=key===-1?"fixed-paint":`player-remap-${key}`;
    if(key!==-1){material.color.setRGB(palette[key*4]/255,palette[key*4+1]/255,palette[key*4+2]/255,THREE.SRGBColorSpace);material.userData={playerRemapIndex:key,playerRemapPosition:remap.indexOf(key),playerRemapLength:remap.length};}
    return new THREE.Mesh(geometry,material);
  });
}
