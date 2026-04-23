const onlyAscii = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s.-]/g, '')

const buildTlv = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, '0')}${value}`

const normalizeMerchantName = (value: string) =>
  onlyAscii(value)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25)

const normalizeMerchantCity = (value: string) =>
  onlyAscii(value)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15)

const normalizeTxid = (value: string) =>
  onlyAscii(value)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 25) || 'TIGGER1990'

const crc16 = (payload: string) => {
  let crc = 0xffff

  for (let offset = 0; offset < payload.length; offset += 1) {
    crc ^= payload.charCodeAt(offset) << 8

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export const buildPixPayload = ({
  amount,
  city,
  key,
  merchantName,
  reference,
}: {
  amount: number
  city: string
  key: string
  merchantName: string
  reference: string
}) => {
  const txid = normalizeTxid(reference)
  const payloadWithoutCrc = [
    buildTlv('00', '01'),
    buildTlv('01', '12'),
    buildTlv(
      '26',
      [buildTlv('00', 'BR.GOV.BCB.PIX'), buildTlv('01', key.trim())].join(''),
    ),
    buildTlv('52', '0000'),
    buildTlv('53', '986'),
    buildTlv('54', amount.toFixed(2)),
    buildTlv('58', 'BR'),
    buildTlv('59', normalizeMerchantName(merchantName)),
    buildTlv('60', normalizeMerchantCity(city)),
    buildTlv('62', buildTlv('05', txid)),
    '6304',
  ].join('')

  return {
    payload: `${payloadWithoutCrc}${crc16(payloadWithoutCrc)}`,
    txid,
  }
}
