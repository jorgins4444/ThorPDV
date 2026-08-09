'use server';

import { createHash } from 'node:crypto';
import * as forge from 'node-forge';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE='thorpdv_test_session';
const MAX_PFX_BYTES=5*1024*1024;
type RpcResult={ok?:boolean;error?:string;[key:string]:unknown};

async function getSessionToken(){const c=await cookies();const token=c.get(SESSION_COOKIE)?.value;if(!token)redirect('/login');return token;}
async function rpc(name:string,args:Record<string,unknown>){const supabase=await createClient();const {data,error}=await supabase.rpc(name,args);if(error)return {ok:false,error:error.message} as RpcResult;return (data??{ok:false}) as RpcResult;}
function cleanCnpj(value:string){const digits=value.replace(/\D/g,'');return digits.length===14?digits:'';}
function fingerprint(cert:forge.pki.Certificate){const der=forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();const md=forge.md.sha256.create();md.update(der);return md.digest().toHex().toUpperCase().match(/.{1,2}/g)?.join(':')??'';}

export async function erpFiscalCertificateUpload(formData:FormData){
  const token=await getSessionToken();
  const file=formData.get('certificate');
  const password=String(formData.get('password')??'');
  if(!(file instanceof File)||file.size===0)return {ok:false,error:'Selecione um arquivo .pfx ou .p12.'};
  if(!/\.(pfx|p12)$/i.test(file.name))return {ok:false,error:'O certificado deve estar no formato .pfx ou .p12.'};
  if(!password)return {ok:false,error:'Informe a senha do certificado.'};
  if(file.size>MAX_PFX_BYTES)return {ok:false,error:'O certificado excede o limite de 5 MB.'};

  let bytes:Buffer;let cert:forge.pki.Certificate;
  try{
    bytes=Buffer.from(await file.arrayBuffer());
    const binary=bytes.toString('binary');
    const asn1=forge.asn1.fromDer(forge.util.createBuffer(binary));
    const p12=forge.pkcs12.pkcs12FromAsn1(asn1,false,password);
    const certBags=p12.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag]??[];
    cert=certBags.find(b=>Boolean(b.cert))?.cert as forge.pki.Certificate;
    const shrouded=p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]??[];
    const keys=p12.getBags({bagType:forge.pki.oids.keyBag})[forge.pki.oids.keyBag]??[];
    if(!cert) return {ok:false,error:'O arquivo não contém um certificado X.509 válido.'};
    if(![...shrouded,...keys].some(b=>Boolean(b.key)))return {ok:false,error:'O arquivo não contém a chave privada necessária para assinar NF-e/NFC-e.'};
  }catch{
    return {ok:false,error:'Não foi possível abrir o PFX. Verifique o arquivo e a senha informada.'};
  }

  const now=new Date();
  if(cert.validity.notAfter.getTime()<=now.getTime())return {ok:false,error:`O certificado está expirado desde ${cert.validity.notAfter.toLocaleDateString('pt-BR')}.`};
  const cn=String(cert.subject.getField('CN')?.value??'');
  const cnpjAttr=cert.subject.attributes.find(a=>a.type==='2.16.76.1.3.3');
  const cnpj=cleanCnpj(String(cnpjAttr?.value??cn));
  const fileSha=createHash('sha256').update(bytes).digest('hex');
  const result=await rpc('erp_fiscal_certificate_save',{
    p_token:token,p_filename:file.name,p_pfx_base64:bytes.toString('base64'),p_password:password,
    p_subject_cn:cn||null,p_subject_cnpj:cnpj||null,p_serial_number:cert.serialNumber||null,
    p_valid_from:cert.validity.notBefore.toISOString(),p_valid_to:cert.validity.notAfter.toISOString(),
    p_fingerprint_sha256:fingerprint(cert)||null,p_file_sha256:fileSha,
  });
  if(!result.ok)return {ok:false,error:String(result.error??'Não foi possível salvar o certificado.')};
  return {ok:true,certificate:result.certificate};
}

export async function erpFiscalCertificateGet(){const token=await getSessionToken();return rpc('erp_fiscal_certificate_get',{p_token:token});}
export async function erpFiscalCertificateDelete(){const token=await getSessionToken();return rpc('erp_fiscal_certificate_delete',{p_token:token});}
