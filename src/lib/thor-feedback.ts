'use client';

export type ThorFeedbackKind='success'|'info'|'warning'|'error';
export type ThorFeedbackPayload={kind?:ThorFeedbackKind;title?:string;message?:string;duration?:number};

export function thorFeedback(payload:ThorFeedbackPayload){
  if(typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent<ThorFeedbackPayload>('thor:feedback',{detail:payload}));
}

export function thorSuccess(message:string,title?:string,duration?:number){thorFeedback({kind:'success',title,message,duration});}
export function thorInfo(message:string,title?:string,duration?:number){thorFeedback({kind:'info',title,message,duration});}
export function thorWarning(message:string,title?:string,duration?:number){thorFeedback({kind:'warning',title,message,duration});}
export function thorError(message:string,title?:string,duration?:number){thorFeedback({kind:'error',title,message,duration});}
