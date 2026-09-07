"use client";
import { useState } from "react";
const initials=(value:string)=>value.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
export function getClubLogoUrl(tmClubId:string|number){return `https://tmssl.akamaized.net/images/wappen/head/${tmClubId}.png`;}
export function ClubLogo({name,tmClubId,size="sm"}:{name:string;tmClubId:string|number;size?:"sm"|"md"|"lg"}){const [failed,setFailed]=useState(false);return <span className={`club-logo club-logo-${size}`}>{!failed&&<img src={getClubLogoUrl(tmClubId)} alt="" onError={()=>setFailed(true)}/>}<span className={failed?"":"sr-only"}>{initials(name)}</span></span>}
export function PlayerAvatar({name,portraitUrl,size="sm"}:{name:string;portraitUrl?:string|null;size?:"sm"|"lg"}){const [failed,setFailed]=useState(!portraitUrl);return <span className={`player-avatar player-avatar-${size}`}>{!failed&&<img src={portraitUrl!} alt="" onError={()=>setFailed(true)}/>}<span className={failed?"":"sr-only"}>{initials(name)}</span></span>}
