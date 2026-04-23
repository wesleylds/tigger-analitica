import https from 'node:https'

const ids = [1, 2, 3, 4, 5, 6, 7, 8]

const fetchLeague = (id) =>
  new Promise((resolve) => {
    const url =
      `https://api.bbtips.com.br/api/futebolvirtual/old?liga=${id}` +
      '&futuro=false&Horas=Horas12&tipoOdd=&dadosAlteracao='

    https
      .get(url, (response) => {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          try {
            const payload = JSON.parse(body)
            const lines = Array.isArray(payload?.Linhas) ? payload.Linhas : []
            const cols = lines.reduce((sum, line) => {
              const lineCols = Array.isArray(line?.Colunas) ? line.Colunas.length : 0
              return sum + lineCols
            }, 0)
            const firstWithTeams = (lines[0]?.Colunas ?? []).find(
              (column) => column?.TimeA && column?.TimeB,
            )

            resolve({
              cols,
              first: firstWithTeams
                ? `${firstWithTeams.TimeA} x ${firstWithTeams.TimeB}`
                : '-',
              id,
              lines: lines.length,
              status: response.statusCode,
            })
          } catch (error) {
            resolve({
              error: error instanceof Error ? error.message : String(error),
              id,
              preview: body.slice(0, 120),
              status: response.statusCode,
            })
          }
        })
      })
      .on('error', (error) => {
        resolve({
          error: error.message,
          id,
        })
      })
  })

const run = async () => {
  for (const id of ids) {
    const output = await fetchLeague(id)
    console.log(JSON.stringify(output))
  }
}

await run()
