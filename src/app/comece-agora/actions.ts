'use server';

import { createClient } from '@/lib/supabase/server';

type LeadInput = {
  companyName: string;
  cnpj: string;
  ownerName: string;
  phone: string;
  businessNiche: string;
  email: string;
  plan: 'basic' | 'intermediate' | 'advanced';
  website?: string;
};

const cleanDigits = (value: string) => value.replace(/\D/g, '');
const cleanText = (value: string, max: number) => value.trim().replace(/\s+/g, ' ').slice(0, max);
const planNames = { basic: 'Básico', intermediate: 'Intermediário', advanced: 'Avançado' } as const;

export async function submitLead(input: LeadInput) {
  if (input.website) return { ok: true, whatsappUrl: '/' };
  const payload = {
    company_name: cleanText(input.companyName, 160),
    cnpj: cleanDigits(input.cnpj),
    owner_name: cleanText(input.ownerName, 120),
    phone: cleanDigits(input.phone),
    business_niche: cleanText(input.businessNiche, 100),
    email: input.email.trim().toLowerCase().slice(0, 180),
    plan: input.plan,
    status: 'new',
    notes: '',
    source: 'public_website',
  };
  if (payload.company_name.length < 2 || payload.cnpj.length !== 14 || payload.owner_name.length < 2 ||
      payload.phone.length < 10 || payload.business_niche.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return { ok: false, error: 'Confira os dados informados antes de continuar.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('crm_leads').insert(payload);
  if (error) return { ok: false, error: 'Não foi possível registrar seu interesse agora. Tente novamente.' };

  const message = [
    'Olá! Quero conhecer o ThorGestão.',
    '',
    `Plano: ${planNames[input.plan]}`,
    `Empresa: ${payload.company_name}`,
    `CNPJ: ${payload.cnpj}`,
    `Proprietário: ${payload.owner_name}`,
    `Telefone: ${payload.phone}`,
    `Nicho: ${payload.business_niche}`,
    `E-mail: ${payload.email}`,
  ].join('\n');
  return { ok: true, whatsappUrl: `https://wa.me/5586994857433?text=${encodeURIComponent(message)}` };
}
