"use client";
import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";

export function WorkshopEarth({ latitude, longitude, onPin }: { latitude: number; longitude: number; onPin: (lat: number, lon: number) => void }) {
  const node=useRef<HTMLDivElement>(null), map=useRef<MapLibreMap|null>(null), marker=useRef<Marker|null>(null), callback=useRef(onPin);
  useEffect(()=>{callback.current=onPin;},[onPin]);
  useEffect(()=>{
    let cancelled=false;
    void import("maplibre-gl").then(lib=>{
      if(cancelled||!node.current)return;
      const instance=new lib.Map({container:node.current,center:[longitude,latitude],zoom:10,style:{version:8,sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},layers:[{id:"osm",type:"raster",source:"osm",paint:{"raster-saturation":-.6}}]}});
      instance.addControl(new lib.NavigationControl({showCompass:false}),"top-right");
      map.current=instance; marker.current=new lib.Marker({color:"#ef5b3f"}).setLngLat([longitude,latitude]).addTo(instance);
      instance.on("click",e=>callback.current(Number(e.lngLat.lat.toFixed(5)),Number(e.lngLat.lng.toFixed(5))));
    });
    return()=>{cancelled=true;map.current?.remove();map.current=null;marker.current=null;};
    // Subsequent pin changes use the existing map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{map.current?.jumpTo({center:[longitude,latitude]});marker.current?.setLngLat([longitude,latitude]);},[latitude,longitude]);
  return <div className="workshop-earth" ref={node} aria-label="Earth source map. Click to choose the terrain center." />;
}
