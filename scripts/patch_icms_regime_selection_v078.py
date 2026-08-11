from pathlib import Path

p=Path('supabase/functions/thorfiscal-authorize/index.ts')
s=p.read_text()
old='''  const icms: Json = {\n    origem: origin,\n    ...(csosn ? { csosn } : { cst }),\n  };'''
new='''  const icms: Json = {\n    origem: origin,\n    ...([1, 2, 4].includes(regime) ? { csosn } : { cst }),\n  };'''
if old not in s:
    if new in s:
        raise SystemExit(0)
    raise SystemExit('ICMS regime selection anchor not found')
s=s.replace(old,new,1)
p.write_text(s)
