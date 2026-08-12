from pathlib import Path

def rep(path,old,new,count=1):
 p=Path(path);s=p.read_text(encoding='utf-8')
 if old not in s: raise SystemExit(f'marker missing {path}: {old[:100]}')
 p.write_text(s.replace(old,new,count),encoding='utf-8')

p='src/app/dashboard/[...slug]/branches-workspace.tsx'
rep(p,"import { FormEvent, useMemo, useState, useTransition } from 'react';","import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react';")
rep(p,"import { branchLicenseSave } from './branch-license-actions';","import { branchLicenseList, branchLicenseSave } from './branch-license-actions';")
rep(p," const router=useRouter();const [editing,setEditing]", " const router=useRouter();const [rows,setRows]=useState<Row[]>(initialBranches);const [editing,setEditing]")
rep(p," const branchLimit=Math.max(num(license.branch_limit),1);const used=initialBranches.length;const remaining=Math.max(branchLimit-used,0);const enabled=Boolean((license.modules as Record<string,boolean>|undefined)?.branches);const headquarters=initialBranches.find(b=>Boolean(b.is_headquarters));", " useEffect(()=>{let alive=true;void branchLicenseList().then(r=>{if(alive&&r.ok)setRows(r.data)});return()=>{alive=false}},[]);\n const branchLimit=Math.max(num(license.branch_limit),1);const used=rows.length;const remaining=Math.max(branchLimit-used,0);const enabled=Boolean((license.modules as Record<string,boolean>|undefined)?.branches);const headquarters=rows.find(b=>Boolean(b.is_headquarters));")
rep(p," const sorted=useMemo(()=>[...initialBranches].sort((a,b)=>Number(Boolean(b.is_headquarters))-Number(Boolean(a.is_headquarters))||text(a.name).localeCompare(text(b.name),'pt-BR')),[initialBranches]);", " const sorted=useMemo(()=>[...rows].sort((a,b)=>Number(Boolean(b.is_headquarters))-Number(Boolean(a.is_headquarters))||text(a.name).localeCompare(text(b.name),'pt-BR')),[rows]);")
rep(p,"setOpen(false);setEditing(null);setMessage('Filial salva e vinculada à licença.');router.refresh();", "setOpen(false);setEditing(null);setMessage('Filial salva e vinculada à licença.');const latest=await branchLicenseList();if(latest.ok)setRows(latest.data);router.refresh();")

p='src/app/dashboard/[...slug]/branch-config-workspace.tsx'
rep(p,"import Link from 'next/link';", "import Link from 'next/link';\nimport { useSearchParams } from 'next/navigation';")
rep(p,"export function BranchConfigWorkspace({branches}:{branches:Row[]}){\n  const [branchId,setBranchId]=useState(text(branches[0]?.id));", "export function BranchConfigWorkspace({branches}:{branches:Row[]}){\n  const searchParams=useSearchParams();\n  const requestedBranch=text(searchParams.get('branch'));\n  const initialBranch=branches.some(b=>text(b.id)===requestedBranch)?requestedBranch:text(branches[0]?.id);\n  const [branchId,setBranchId]=useState(initialBranch);")
rep(p,"<p>Terminais, parâmetros do PDV e integrações. CNPJ, IE, CRT, endereço e demais dados do emitente são alterados exclusivamente em Administrativo → Matriz; certificado, ambiente, séries, CSC e DANFE ficam em Fiscal.</p>", "<p>Terminais, parâmetros do PDV e integrações da unidade selecionada. Dados da Matriz ficam em Administrativo → Matriz; dados cadastrais das filiais ficam em Administrativo → Lojas / Filiais. Certificado, ambiente, séries, CSC e DANFE ficam em Fiscal.</p>")

for f,m in {
 'src/app/dashboard/[...slug]/branches-workspace.tsx':['branchLicenseList','useEffect','setRows'],
 'src/app/dashboard/[...slug]/branch-config-workspace.tsx':['useSearchParams','requestedBranch','Lojas / Filiais'],
}.items():
 s=Path(f).read_text(encoding='utf-8')
 for x in m:
  if x not in s: raise SystemExit(f'{f}: missing {x}')
print('branch profile routing patch OK')
