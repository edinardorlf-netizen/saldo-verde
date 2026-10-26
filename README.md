# Saldo Verde

Controle financeiro pessoal com grupos compartilhados para a casa e para viagens.
Funciona no celular como app instalável (PWA).

**Endereço:** https://edinardorlf-netizen.github.io/saldo-verde/

## O que tem

**Pessoal** (salvo só no aparelho)
- Visão geral do mês com receitas, gastos, saldo e meta de poupança
- Cartões de crédito com parcelamento automático por fatura
- Histórico mensal e dicas financeiras

**Grupos** (sincronizados pela nuvem, com login)
- Casa / família: divisão igual, por proporção (ex.: pela renda) ou por valores; filhos sem login, mesada e gastos por filho
- Viagem: moeda própria, cada gasto dividido só entre quem participou, encerramento da viagem
- Saldos de cada pessoa e o menor número de pagamentos para todos ficarem quites
- Convite por código ou link; quem entra pode assumir um nome já cadastrado
- Atualização em tempo real entre os celulares

## Configurar a nuvem (Supabase)

1. Crie um projeto em https://supabase.com (plano gratuito).
2. Em **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication → URL Configuration**, use o endereço do app em **Site URL** e em **Redirect URLs**.
4. Em **Project Settings → API**, copie o **Project URL** e a chave pública (**anon** ou **publishable**) para `config.js`.

A chave pública pode ficar no site: quem protege os dados são as regras de segurança do banco
(cada pessoa só enxerga os grupos de que participa).

## Desenvolvimento

```bash
npm install
npm run build   # gera app.js a partir de src/
```

- `src/App.jsx`: controle pessoal
- `src/groups.jsx`: grupos compartilhados
- `src/shared.jsx`: funções e componentes comuns
- `supabase/schema.sql`: tabelas, regras de segurança e funções do banco
