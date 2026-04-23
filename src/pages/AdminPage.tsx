interface AdminPageProps {
  logs: string[]
  stats: Array<{ label: string; value: string }>
  pendingPayments: Array<{
    accountId: string
    amountLabel: string
    email: string
    name: string
    orderId: string
    referenceId: string
    requestedAtLabel: string
    statusLabel: string
  }>
  onApprovePayment: (accountId: string) => void
}

export function AdminPage({ logs, stats, pendingPayments, onApprovePayment }: AdminPageProps) {
  return (
    <section className="page-grid">
      <section className="page-header-panel">
        <div>
          <span className="eyebrow">admin separado</span>
          <h1>Gestao fora da experiencia principal</h1>
          <p>
            Usuarios, assinaturas, suporte e logs ficam aqui, sem contaminar a home de analise.
          </p>
        </div>
        <div className="header-media">
          <img src="/images/history-tunnel.png" alt="Admin" />
        </div>
      </section>

      <section className="admin-grid">
        <div className="stats-grid">
          {stats.map((item) => (
            <article key={item.label} className="stat-box">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
        <div className="detail-panel">
          <div className="editor-head">
            <span className="eyebrow">pagamentos pendentes</span>
            <h2>Confirmacoes manuais</h2>
          </div>

          {pendingPayments.length === 0 ? (
            <div className="account-billing-ok">
              <strong>Nenhum comprovante aguardando agora.</strong>
              <p>Quando um cliente marcar que ja pagou, ele aparece aqui para liberacao.</p>
            </div>
          ) : (
            <div className="admin-approvals">
              {pendingPayments.map((payment) => (
                <article key={payment.accountId} className="admin-approval-card">
                  <div>
                    <span>{payment.name}</span>
                    <strong>{payment.email}</strong>
                  </div>
                  <div>
                    <span>Pedido</span>
                    <strong>{payment.orderId}</strong>
                  </div>
                  <div>
                    <span>Referencia</span>
                    <strong>{payment.referenceId}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{payment.statusLabel}</strong>
                  </div>
                  <div>
                    <span>Valor</span>
                    <strong>{payment.amountLabel}</strong>
                  </div>
                  <div>
                    <span>Marcado em</span>
                    <strong>{payment.requestedAtLabel}</strong>
                  </div>
                  <button type="button" className="solid-button" onClick={() => onApprovePayment(payment.accountId)}>
                    Liberar 30 dias
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="detail-panel">
          <div className="editor-head">
            <span className="eyebrow">logs operacionais</span>
            <h2>Fila do sistema</h2>
          </div>
          <div className="log-list">
            {logs.map((log) => (
              <div key={log} className="log-row">
                {log}
              </div>
            ))}
          </div>
        </div>
      </section>
    </section>
  )
}
