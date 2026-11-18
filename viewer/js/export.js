// Static model export, separate from animation state and renderer extensions.
import {Chess} from '../vendor/chess.js';
import {pieceXml} from './pieces.js';
import {sqPos} from './board.js';
import {studyFxXml} from './fx.js';
import {THEMES} from './themes.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const need=(ok,message)=>{if(!ok)throw new Error(message);};

export function projectPortableX3D(xml,{title,metadata}={}) {
  need(typeof xml==='string'&&xml.length<=16*1024*1024&&/<X3D\b/.test(xml),'Expected a bounded owned X3D document');
  let count=0;
  xml=xml.replace(/<Shape\b[^>]*>/g,tag=>tag.replace(/\s+pointerEvents\s*=\s*(?:"[^"]*"|'[^']*')/g,()=>{count++;return '';}));
  const tags=(title?`<meta name="title" content="${esc(title)}"/>`:'')+
    (metadata?`<meta name="x3dchess.snapshot" content="${esc(JSON.stringify(metadata))}"/>`:'');
  if(tags){
    if(/<\/head>/.test(xml))xml=xml.replace(/<\/head>/,()=>tags+'</head>');
    else if(/<head\s*\/>/.test(xml))xml=xml.replace(/<head\s*\/>/,()=>'<head>'+tags+'</head>');
    else xml=xml.replace(/<X3D\b[^>]*>/,tag=>tag+'<head>'+tags+'</head>');
  }
  return {xml,losses:count?[{field:'Shape.pointerEvents',records:count,reason:'X_ITE picking extension omitted from portable X3D.'}]:[]};
}

export function coordinateLabelsXml(origin=[0,0,0]) {
  const label=(text,x,z)=>`<Transform translation="${origin[0]+x} ${origin[1]+0.12} ${origin[2]+z}" rotation="1 0 0 -1.5707963267948966"><Shape pointerEvents="false"><Appearance><Material diffuseColor="0.65 0.73 0.7" emissiveColor="0.42 0.49 0.45"/></Appearance><Text string='"${text}"'><FontStyle family='"SANS"' size="0.25" justify='"MIDDLE" "MIDDLE"'/></Text></Shape></Transform>`;
  return '<Group>'+Array.from({length:8},(_,i)=>label('abcdefgh'[i],i-3.5,4.25)+label(String(i+1),-4.25,3.5-i)).join('')+'</Group>';
}

export function exportPositionX3D({fen,title='Chess position',metadata={},highlights,themeName='classic'}={}) {
  const chess=new Chess(fen),origin=[0,0,0],theme=THEMES[themeName];need(theme,'Unknown export theme');
  const squares=Array.from({length:64},(_,i)=>{const sq='abcdefgh'[i%8]+(Math.floor(i/8)+1),[x,,z]=sqPos(sq,origin),c=(i%8+Math.floor(i/8))%2?theme.light:theme.dark;return `<Transform translation="${x} -0.045 ${z}"><Shape><Appearance><Material diffuseColor="${c}"/></Appearance><Box size="0.99 0.09 0.99"/></Shape></Transform>`;}).join('');
  const pieces=chess.board().flat().filter(Boolean).map(p=>{const [x,y,z]=sqPos(p.square,origin);return `<Transform DEF="piece_${p.square}" translation="${x} ${y} ${z}">${pieceXml(p.type,p.color,theme)}</Transform>`;}).join('');
  const info={...metadata,schema:'x3dchess.position/1',input_fen:fen,fen:chess.fen(),turn:chess.turn(),
    representation:'Static model occupancy with authored appearance. Animation, engine workers and live evaluation history are not serialized.',
    theme:themeName,piece_count:chess.board().flat().filter(Boolean).length};
  const xml=`<?xml version="1.0" encoding="UTF-8"?><X3D profile="Interchange" version="4.0"><head><component name="Text" level="1"/></head><Scene><WorldInfo title="${esc(title)}"/><NavigationInfo type='"EXAMINE" "ANY"'/><Background skyColor="0.025 0.045 0.045"/><Viewpoint position="6 9 10" orientation="-0.833 0.553 0.006 0.847" description="Position overview"/><DirectionalLight direction="-0.3 -1 -0.5" intensity="0.9"/><DirectionalLight direction="0.5 -0.5 0.7" intensity="0.35"/><Transform translation="0 -0.2 0"><Shape><Appearance><Material diffuseColor="0.055 0.085 0.08" specularColor="0.35 0.35 0.3" shininess="0.5"/></Appearance><Box size="8.9 0.22 8.9"/></Shape></Transform>${squares}${coordinateLabelsXml(origin)}${pieces}${highlights?studyFxXml(highlights,origin):''}</Scene></X3D>`;
  const projected=projectPortableX3D(xml,{title,metadata:info});return {...projected,metadata:info};
}
