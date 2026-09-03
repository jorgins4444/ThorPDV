'use client';

import { useEffect,useMemo,useState } from 'react';

export const LIST_PAGE_SIZE=10;

export function useListPagination<T>(rows:T[],pageSize=LIST_PAGE_SIZE){
  const [page,setPage]=useState(0);
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
  useEffect(()=>{setPage(current=>Math.min(current,pageCount-1));},[pageCount]);
  const pageRows=useMemo(()=>rows.slice(page*pageSize,(page+1)*pageSize),[rows,page,pageSize]);
  const from=rows.length===0?0:page*pageSize+1;
  const to=Math.min((page+1)*pageSize,rows.length);
  return {page,setPage,pageCount,pageRows,from,to,total:rows.length,pageSize};
}

type Props={page:number;pageCount:number;total:number;from:number;to:number;onPage:(page:number)=>void;label?:string};
export function ListPagination({page,pageCount,total,from,to,onPage,label='registro(s)'}:Props){
  return <footer className="erp-table-footer list-pagination-footer"><span>{total} {label} • exibindo {from}–{to}</span><div className="erp-pagination"><button type="button" className="erp-ghost" disabled={page<=0} onClick={()=>onPage(Math.max(0,page-1))}>← Anterior</button><span>Página {page+1} de {pageCount}</span><button type="button" className="erp-ghost" disabled={page>=pageCount-1} onClick={()=>onPage(Math.min(pageCount-1,page+1))}>Próxima →</button></div><span>10 por página</span></footer>;
}
