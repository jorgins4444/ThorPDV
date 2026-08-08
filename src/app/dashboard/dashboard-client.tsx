'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { logout } from './actions';

type MenuGroup = {
  label: string;
  icon: string;
  href?: string;
  items?: { label: string; href: string }[];
};

type TabKey = 'sales' | 'finance' | 'stock' | 'people' | 'equipment' | 'open';

const menu: MenuGroup[] = [
  { label: 'Dashboard', icon: '▣', href: '/dashboard' },
  {
    label: 'Pessoas', icon: '●', items: [
      { label: 'Clientes', href: '/dashboard/clientes' },
      { label: 'Fornecedores', href: '/dashboard/fornecedores' },
      { label: 'Perfil Usuário PDV', href: '/dashboard/perfis-pdv' },
      { label: 'Usuários PDV', href: '/dashboard/usuarios-pdv' },
      { label: 'Perfil Usuário ADM', href: '/dashboard/perfis-adm' },
      { label: 'Usuários ADM', href: '/dashboard/usuarios-adm' },
    ],
  },
  {
    label: 'Vendas', icon: '▰', items: [
      { label: 'Operações de Caixa', href: '/dashboard/vendas' },
      { label: 'Nova Venda', href: '/dashboard/vendas/nova' },
    ],
  },
  {
    label: 'Produtos', icon: '◆', items: [
      { label: 'Produtos', href: '/dashboard/produtos' },
      { label: 'Grupos', href: '/dashboard/grupos' },
      { label: 'Classes', href: '/dashboard/classes' },
      { label: 'Modificadores', href: '/dashboard/modificadores' },
    ],
  },
  {
    label: 'Tabela de Preços', icon: '◇', items: [
      { label: 'Tabela de Preços', href: '/dashboard/tabelas-precos' },
      { label: 'Copiar', href: '/dashboard/tabelas-precos/copiar' },
      { label: 'Ajustes Programados', href: '/dashboard/tabelas-precos/ajustes' },
      { label: 'Promoções', href: '/dashboard/promocoes' },
    ],
  },
  {
    label: 'Estoque', icon: '⬡', items: [
      { label: 'Movimentações', href: '/dashboard/estoque' },
      { label: 'Inventário', href: '/dashboard/estoque/inventario' },
      { label: 'Ajustes', href: '/dashboard/estoque/ajustes' },
      { label: 'Transferências', href: '/dashboard/estoque/transferencias' },
    ],
  },
  {
    label: 'Financeiro', icon: '▤', items: [
      { label: 'Contas a Receber', href: '/dashboard/financeiro/receber' },
      { label: 'Contas a Pagar', href: '/dashboard/financeiro/pagar' },
      { label: 'Fluxo de Caixa', href: '/dashboard/financeiro/fluxo-caixa' },
      { label: 'Conciliação', href: '/dashboard/financeiro/conciliacao' },
    ],
  },
  {
    label: 'Administrativo', icon: '▧', items: [
      { label: 'Empresas e Filiais', href: '/dashboard/administrativo/empresas' },
      { label: 'Caixas e PDVs', href: '/dashboard/administrativo/pdvs' },
      { label: 'Fiscal', href: '/dashboard/fiscal' },
      { label: 'Integrações', href: '/dashboard/integracoes' },
      { label: 'Configurações', href: '/dashboard/configuracoes' },
    ],
  },
  {
    label: 'Relatórios', icon: '▥', items: [
      { label: 'Financeiro', href: '/dashboard/relatorios/financeiro' },
      { label: 'Vendas PDV', href: '/dashboard/relatorios/vendas' },
      { label: 'Estoque', href: '/dashboard/relatorios/estoque' },
      { label: 'Listagens', href: '/dashboard/relatorios/listagens' },
    ],
  },
  {
    label: 'Atendimento', icon: '◉', items: [
      { label: 'Chamados', href: '/dashboard/atendimento' },
      { label: 'Mensagens', href: '/dashboard/atendimento/mensagens' },
      { label: 'SLA', href: '/dashboard/atendimento/sla' },
    ],
  },
  { label: 'Ajuda', icon: '?', href: '/dashboard/ajuda' },
];

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'sales', label: 'Vendas PDV', icon: '▰' },
  { key: 'finance', label: 'Financeiro', icon: '$' },
  { key: 'stock', label: 'Estoque', icon: '⬡' },
  { key: 'people', label: 'Pessoas', icon: '●' },
  { key: 'equipment', label: 'Painel de equipamentos', icon: '▣' },
  { key: 'open', label: 'Contas em aberto', icon: '▤' },
];

const tabData: Record<TabKey, {
  cards: { label: string; value: string; detail: string; tone: string; icon: string }[];
  sections: { title: string; icon: string; detail: string }[];
}> = {
  sales: {
    cards: [
      { label: 'Vendas faturadas', value: 'R$ 0,00', detail: 'Nenhuma venda faturada no período', tone: 'teal', icon: 'R$' },
      { label: 'Vendas PDV', value: 'R$ 0,00', detail: 'Nenhuma venda PDV no período', tone: 'amber', icon: 'PDV' },
      { label: 'Cancelamentos', value: 'R$ 0,00', detail: 'Nenhuma venda cancelada', tone: 'coral', icon: '×' },
      { label: 'Estornos / devoluções', value: 'R$ 0,00', detail: 'Nenhuma venda estornada', tone: 'violet', icon: '↶' },
    ],
    sections: [
      { title: 'Produtos mais vendidos', icon: '★', detail: 'Ranking de produtos por quantidade e faturamento.' },
      { title: 'Vendas por hora', icon: '◷', detail: 'Distribuição das vendas ao longo do dia.' },
      { title: 'Formas de recebimento', icon: '▰', detail: 'Pix, dinheiro, cartões, crediário e demais formas.' },
      { title: 'Faturamento por filial', icon: '▥', detail: 'Comparativo entre matriz e filiais.' },
    ],
  },
  finance: {
    cards: [
      { label: 'A receber hoje', value: 'R$ 0,00', detail: 'Títulos com vencimento hoje', tone: 'teal', icon: '↓' },
      { label: 'A pagar hoje', value: 'R$ 0,00', detail: 'Compromissos com vencimento hoje', tone: 'amber', icon: '↑' },
      { label: 'Saldo previsto', value: 'R$ 0,00', detail: 'Receber menos pagar', tone: 'violet', icon: 'Σ' },
      { label: 'Inadimplência', value: 'R$ 0,00', detail: 'Nenhum título vencido', tone: 'coral', icon: '!' },
    ],
    sections: [
      { title: 'Fluxo de caixa', icon: '↕', detail: 'Entradas, saídas e saldo consolidado.' },
      { title: 'Contas a receber', icon: '↓', detail: 'Títulos em aberto e recebidos.' },
      { title: 'Contas a pagar', icon: '↑', detail: 'Despesas e fornecedores.' },
      { title: 'Conciliação', icon: '✓', detail: 'Conciliação de Pix, cartão e banco.' },
    ],
  },
  stock: {
    cards: [
      { label: 'Itens em estoque', value: '0', detail: 'Saldo disponível', tone: 'teal', icon: '⬡' },
      { label: 'Estoque baixo', value: '0', detail: 'Produtos abaixo do mínimo', tone: 'amber', icon: '!' },
      { label: 'Sem estoque', value: '0', detail: 'Produtos zerados', tone: 'coral', icon: '0' },
      { label: 'Valor do estoque', value: 'R$ 0,00', detail: 'Custo atual consolidado', tone: 'violet', icon: 'R$' },
    ],
    sections: [
      { title: 'Estoque crítico', icon: '!', detail: 'Produtos que precisam de reposição.' },
      { title: 'Últimas movimentações', icon: '↕', detail: 'Entradas, saídas, ajustes e transferências.' },
      { title: 'Inventários', icon: '✓', detail: 'Contagens abertas e concluídas.' },
      { title: 'Estoque por filial', icon: '▥', detail: 'Saldos separados por estabelecimento.' },
    ],
  },
  people: {
    cards: [
      { label: 'Clientes', value: '0', detail: 'Clientes cadastrados', tone: 'teal', icon: 'C' },
      { label: 'Fornecedores', value: '0', detail: 'Fornecedores cadastrados', tone: 'amber', icon: 'F' },
      { label: 'Usuários PDV', value: '0', detail: 'Operadores do ponto de venda', tone: 'violet', icon: 'P' },
      { label: 'Usuários ADM', value: '1', detail: 'Usuários administrativos', tone: 'coral', icon: 'A' },
    ],
    sections: [
      { title: 'Novos clientes', icon: '+', detail: 'Cadastros realizados recentemente.' },
      { title: 'Clientes com pendências', icon: '!', detail: 'Pendências financeiras ou cadastrais.' },
      { title: 'Acessos recentes', icon: '◷', detail: 'Últimos acessos de usuários.' },
      { title: 'Perfis e permissões', icon: '✓', detail: 'Resumo da política de acesso.' },
    ],
  },
  equipment: {
    cards: [
      { label: 'PDVs online', value: '0', detail: 'Terminais conectados agora', tone: 'teal', icon: 'PDV' },
      { label: 'Impressoras', value: '0', detail: 'Impressoras monitoradas', tone: 'amber', icon: 'IMP' },
      { label: 'Agentes online', value: '0', detail: 'Agentes locais conectados', tone: 'violet', icon: 'AG' },
      { label: 'Alertas', value: '0', detail: 'Nenhuma ocorrência aberta', tone: 'coral', icon: '!' },
    ],
    sections: [
      { title: 'Status dos equipamentos', icon: '●', detail: 'Conectividade e saúde dos dispositivos.' },
      { title: 'Impressoras térmicas', icon: '▣', detail: 'Fila, papel, comunicação e falhas.' },
      { title: 'Serviços e agentes', icon: '⚙', detail: 'Serviços locais, sincronização e heartbeat.' },
      { title: 'Alertas recentes', icon: '!', detail: 'Ocorrências técnicas que exigem atenção.' },
    ],
  },
  open: {
    cards: [
      { label: 'Contas vencidas', value: 'R$ 0,00', detail: 'Nenhum título vencido', tone: 'coral', icon: '!' },
      { label: 'Vence hoje', value: 'R$ 0,00', detail: 'Nenhum vencimento hoje', tone: 'amber', icon: '◷' },
      { label: 'Próximos 7 dias', value: 'R$ 0,00', detail: 'Previsão de curto prazo', tone: 'violet', icon: '7' },
      { label: 'Total em aberto', value: 'R$ 0,00', detail: 'Saldo de títulos em aberto', tone: 'teal', icon: 'R$' },
    ],
    sections: [
      { title: 'Títulos vencidos', icon: '!', detail: 'Clientes e fornecedores com vencimentos.' },
      { title: 'Próximos vencimentos', icon: '◷', detail: 'Agenda financeira dos próximos dias.' },
      { title: 'Cobranças', icon: '▤', detail: 'Boletos, Pix e cobranças vinculadas.' },
      { title: 'Resumo por cliente', icon: '●', detail: 'Concentração dos valores em aberto.' },
    ],
  },
};

const quickActions = [
  ['Nova venda', '/dashboard/vendas/nova', '▰'],
  ['Operações de caixa', '/dashboard/vendas', 'PDV'],
  ['Novo produto', '/dashboard/produtos/novo', '+'],
  ['Novo cliente', '/dashboard/clientes/novo', '●'],
  ['Entrada de estoque', '/dashboard/estoque/nova', '⬡'],
  ['Conta a receber', '/dashboard/financeiro/receber/novo', '↓'],
  ['Conta a pagar', '/dashboard/financeiro/pagar/novo', '↑'],
  ['Emitir NF-e', '/dashboard/fiscal/nfe', 'NF'],
];

function todayInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function DashboardClient({ identity }: { identity: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('sales');
  const [openMenus, setOpenMenus] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [periodStart, setPeriodStart] = useState(todayInput());
  const [periodEnd, setPeriodEnd] = useState(todayInput());
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [branch, setBranch] = useState('Todas as filiais');
  const [expandedSections, setExpandedSections] = useState<string[]>([]);

  const current = useMemo(() => tabData[activeTab], [activeTab]);

  const toggleMenu = (label: string) => {
    setOpenMenus((value) => value.includes(label) ? value.filter((item) => item !== label) : [...value, label]);
  };

  const toggleSection = (title: string) => {
    setExpandedSections((value) => value.includes(title) ? value.filter((item) => item !== title) : [...value, title]);
  };

  return (
    <main className={`erp-shell ${collapsed ? 'erp-collapsed' : ''}`}>
      <header className="erp-header">
        <div className="erp-brand-wrap">
          <Link href="/dashboard" className="erp-logo" aria-label="ThorPDV">
            <span className="erp-bolt">ϟ</span>
            <span>THOR<b>PDV</b></span>
          </Link>
          <button className="erp-icon-btn erp-menu-toggle" type="button" onClick={() => setCollapsed(!collapsed)} aria-label="Alternar menu">☰</button>
        </div>
        <div className="erp-account">
          <button className="erp-notification" type="button" aria-label="Notificações">♢<i /></button>
          <span className="erp-avatar">SA</span>
          <div className="erp-account-copy">
            <strong>SOLVE AUTOMAÇÃO</strong>
            <span>{identity}</span>
          </div>
          <form action={logout}>
            <button className="erp-logout" type="submit">Sair</button>
          </form>
        </div>
      </header>

      <aside className="erp-sidebar">
        <nav className="erp-nav" aria-label="Navegação principal">
          {menu.map((item) => {
            const isOpen = openMenus.includes(item.label);
            if (!item.items) {
              return (
                <Link key={item.label} href={item.href ?? '/dashboard'} className={`erp-nav-item ${item.label === 'Dashboard' ? 'is-active' : ''}`}>
                  <span className="erp-nav-icon">{item.icon}</span>
                  <span className="erp-nav-label">{item.label}</span>
                </Link>
              );
            }

            return (
              <div className={`erp-nav-group ${isOpen ? 'is-open' : ''}`} key={item.label}>
                <button className="erp-nav-item" type="button" onClick={() => toggleMenu(item.label)}>
                  <span className="erp-nav-icon">{item.icon}</span>
                  <span className="erp-nav-label">{item.label}</span>
                  <span className="erp-chevron">⌄</span>
                </button>
                <div className="erp-submenu">
                  {item.items.map((subitem) => (
                    <Link href={subitem.href} key={subitem.label}><span>•</span>{subitem.label}</Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="erp-store-card">
          <span className="erp-nav-icon">▦</span>
          <div className="erp-store-copy"><small>Loja atual</small><strong>MATRIZ</strong></div>
          <span className="erp-chevron">⌄</span>
        </div>
      </aside>

      <section className="erp-main">
        <div className="erp-page-heading">
          <div>
            <p className="erp-eyebrow">Visão geral</p>
            <h1>Dashboard</h1>
            <p>Acompanhe vendas, financeiro, estoque, pessoas e operação em um único painel.</p>
          </div>
          <div className="erp-status-pill"><span /> Sistema operacional</div>
        </div>

        <section className="erp-filter-card" aria-label="Filtros do dashboard">
          <label><span>Data inicial</span><input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
          <label><span>Data final</span><input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
          <label><span>Hora inicial</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label><span>Hora final</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
          <label className="erp-branch-filter"><span>Filial</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option>Todas as filiais</option><option>Matriz</option></select></label>
        </section>

        <section className="erp-tab-card">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={activeTab === tab.key ? 'is-active' : ''}>
              <span>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </section>

        <section className="erp-kpi-grid">
          {current.cards.map((card) => (
            <article className="erp-kpi-card" key={card.label}>
              <div className={`erp-kpi-icon tone-${card.tone}`}>{card.icon}</div>
              <div><strong>{card.value}</strong><h2>{card.label}</h2><p>{card.detail}</p></div>
            </article>
          ))}
        </section>

        <section className="erp-workspace-grid">
          <div className="erp-panel erp-quick-panel">
            <div className="erp-panel-header"><div><h2>Atalhos rápidos</h2><p>Acesse as tarefas mais usadas do ERP.</p></div><span className="erp-chip">Operação</span></div>
            <div className="erp-quick-grid">
              {quickActions.map(([label, href, icon]) => (
                <Link href={href} className="erp-quick-action" key={label}><span>{icon}</span><strong>{label}</strong><small>Abrir módulo →</small></Link>
              ))}
            </div>
          </div>

          <div className="erp-panel erp-alert-panel">
            <div className="erp-panel-header"><div><h2>Central de atenção</h2><p>Pendências que merecem acompanhamento.</p></div><span className="erp-chip erp-chip-green">Tudo certo</span></div>
            <div className="erp-alert-list">
              <div><span className="erp-alert-dot success"/><p><strong>Fiscal</strong><small>Nenhum documento com rejeição pendente.</small></p><b>0</b></div>
              <div><span className="erp-alert-dot warning"/><p><strong>Estoque</strong><small>Nenhum produto abaixo do mínimo.</small></p><b>0</b></div>
              <div><span className="erp-alert-dot violet"/><p><strong>Financeiro</strong><small>Nenhum título vencido em aberto.</small></p><b>0</b></div>
              <div><span className="erp-alert-dot danger"/><p><strong>Equipamentos</strong><small>Nenhum equipamento com falha crítica.</small></p><b>0</b></div>
            </div>
          </div>
        </section>

        <section className="erp-accordion-list">
          {current.sections.map((section) => {
            const expanded = expandedSections.includes(section.title);
            return (
              <article className={`erp-accordion ${expanded ? 'is-expanded' : ''}`} key={section.title}>
                <button type="button" onClick={() => toggleSection(section.title)}>
                  <span className="erp-accordion-icon">{section.icon}</span>
                  <span><strong>{section.title}</strong><small>{section.detail}</small></span>
                  <b>{expanded ? '−' : '+'}</b>
                </button>
                {expanded ? <div className="erp-empty-state"><span>◇</span><p><strong>Sem dados no período selecionado.</strong><small>Quando houver movimentação, o detalhamento aparecerá aqui automaticamente.</small></p></div> : null}
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}