'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './thor-feedback-center.module.css';

type FeedbackKind='success'|'info'|'warning'|'error';
type FeedbackPayload={kind?:FeedbackKind;title?:string;message?:string;duration?:number};
type FeedbackState={id:number;kind:FeedbackKind;title:string;message:string;duration:number}|null;

const successPattern=/\b(salv[oa]|salv[oa]s|salvo com sucesso|salva com sucesso|gravado|gravada|cadastrad[oa]|atualizad[oa]|alterad[oa]|ativad[oa]|desativad[oa]|registrad[oa]|gerad[oa]|importad[oa]|conclu[ií]d[oa]|configurad[oa]|aplicad[oa]|criad[oa]|vinculad[oa]|removid[oa]|exclu[ií]d[oa]|processad[oa]|confirmad[oa]|finalizad[oa]|sucesso)\b/i;
const errorPattern=/\b(erro|falha|falhou|inv[aá]lid[oa]|rejeitad[oa]|n[aã]o foi poss[ií]vel|n[aã]o p[oô]de|cancelad[oa]|pendente|aguardando|aten[cç][aã]o)\b/i;
const likelyMessageSelector='[role="status"],[role="alert"],.studio-message,.erp-message,.message,.alert,.notice,.feedback,.toast,[class*="success"],[class*="message"],[class*="alert"],[class*="notice"],[class*="feedback"],[class*="toast"]';

function compact(value:string){return value.replace(/\s+/g,' ').trim();}
function safeMessage(value:string){const clean=compact(value);return clean.length>190?`${clean.slice(0,187)}…`:clean;}
function titleFor(message:string){
  const value=message.toLocaleLowerCase('pt-BR');
  if(value.includes('produto'))return 'Produto atualizado';
  if(value.includes('cliente'))return 'Cliente atualizado';
  if(value.includes('fornecedor'))return 'Fornecedor atualizado';
  if(value.includes('usuário')||value.includes('usuario'))return 'Usuário atualizado';
  if(value.includes('filial'))return 'Filial atualizada';
  if(value.includes('fiscal')||value.includes('tribut'))return 'Configuração fiscal salva';
  if(value.includes('configura')||value.includes('parâmetro')||value.includes('parametro'))return 'Configuração salva';
  if(value.includes('estoque')||value.includes('entrada'))return 'Estoque atualizado';
  if(value.includes('boleto')||value.includes('remessa')||value.includes('retorno'))return 'Operação bancária concluída';
  if(value.includes('venda')||value.includes('pedido'))return 'Operação concluída';
  if(value.includes('cadastro'))return 'Cadastro salvo';
  return 'Alteração salva';
}

export function ThorFeedbackCenter(){
  const [feedback,setFeedback]=useState<FeedbackState>(null);
  const timerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const lastRef=useRef<{message:string;at:number}>({message:'',at:0});
  const sequenceRef=useRef(0);

  useEffect(()=>{
    const hide=()=>{if(timerRef.current)clearTimeout(timerRef.current);timerRef.current=null;setFeedback(null);};
    const show=(payload:FeedbackPayload)=>{
      const message=safeMessage(payload.message||'Suas alterações foram gravadas com sucesso.');
      const now=Date.now();
      if(message===lastRef.current.message&&now-lastRef.current.at<1800)return;
      lastRef.current={message,at:now};
      if(timerRef.current)clearTimeout(timerRef.current);
      const duration=Math.min(Math.max(payload.duration??3200,1800),8000);
      sequenceRef.current+=1;
      setFeedback({id:sequenceRef.current,kind:payload.kind??'success',title:payload.title||titleFor(message),message,duration});
      timerRef.current=setTimeout(()=>setFeedback(null),duration);
    };

    const onFeedback=(event:Event)=>{
      const detail=(event as CustomEvent<FeedbackPayload>).detail||{};
      show(detail);
    };

    const consider=(raw:string|null|undefined)=>{
      if(!raw)return;
      const message=compact(raw);
      if(message.length<3||message.length>320||errorPattern.test(message)||!successPattern.test(message))return;
      show({kind:'success',message});
    };

    const inspectNode=(node:Node)=>{
      if(node.nodeType===Node.TEXT_NODE){
        const parent=node.parentElement;
        if(parent?.closest(likelyMessageSelector))consider(parent.textContent);
        return;
      }
      if(!(node instanceof HTMLElement))return;
      if(node.matches(likelyMessageSelector))consider(node.textContent);
      node.querySelectorAll(likelyMessageSelector).forEach(element=>consider(element.textContent));
      if(node.childElementCount===0)consider(node.textContent);
    };

    const observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        if(mutation.type==='characterData'){inspectNode(mutation.target);continue;}
        mutation.addedNodes.forEach(inspectNode);
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});

    const nativeAlert=window.alert.bind(window);
    window.alert=(message?:unknown)=>{
      const value=compact(String(message??''));
      if(value&&successPattern.test(value)&&!errorPattern.test(value)){show({kind:'success',message:value});return;}
      nativeAlert(message);
    };

    window.addEventListener('thor:feedback',onFeedback as EventListener);
    window.addEventListener('thor:feedback:close',hide);
    return()=>{
      observer.disconnect();
      window.removeEventListener('thor:feedback',onFeedback as EventListener);
      window.removeEventListener('thor:feedback:close',hide);
      window.alert=nativeAlert;
      if(timerRef.current)clearTimeout(timerRef.current);
    };
  },[]);

  if(!feedback)return null;
  return <div className={styles.viewport} aria-live="polite" aria-atomic="true">
    <section key={feedback.id} className={`${styles.card} ${styles[feedback.kind]}`} role="status" style={{'--thor-feedback-duration':`${feedback.duration}ms`} as React.CSSProperties}>
      <div className={styles.glow}/>
      <div className={styles.iconWrap} aria-hidden="true">
        <svg className={styles.check} viewBox="0 0 72 72" fill="none">
          <circle className={styles.checkCircle} cx="36" cy="36" r="29"/>
          <path className={styles.checkPath} d="M22 37.5 31.5 47 51 27"/>
        </svg>
        <i className={styles.sparkOne}/><i className={styles.sparkTwo}/><i className={styles.sparkThree}/>
      </div>
      <div className={styles.copy}>
        <div className={styles.brand}><span>THOR</span> GESTÃO <b>•</b> GRAVADO</div>
        <strong>{feedback.title}</strong>
        <p>{feedback.message}</p>
      </div>
      <button type="button" className={styles.close} onClick={()=>window.dispatchEvent(new Event('thor:feedback:close'))} aria-label="Fechar confirmação">×</button>
      <div className={styles.progress}/>
    </section>
  </div>;
}
