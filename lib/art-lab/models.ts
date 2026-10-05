export type ModelOption={id:string;label:string;url:string;source:string;bytes:number;triangles:number|null;remap:boolean;turret:boolean;status:string;
  /** Pre-rendered picture (npm run thumbs:glb), only while it matches the GLB on disk. */
  thumbnail?:string|null};
export type ModelActor={key:string;actor:string;name:string;category:string;factions:string[];status:string;thumbnail:string|null;nativeThumbnail:string|null;nativeFormat:string;reconstructionNotice:string|null;options:ModelOption[];requiredWork:string[]};
export type ModelLibrary={mode:"ra2"|"classic";actors:ModelActor[];jobs:{total:number;drafts:number;generating:number;failed:number};privateJobs:{total:number;drafts:number;generating:number;failed:number;heldBack:number};coverage:{total:number;withGlb:number};nativeExports:{vxl:number;hva:number;shp:number};apiSpendUsd:number};
