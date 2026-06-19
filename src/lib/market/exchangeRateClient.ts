type RateType = 'oficial' | 'mep' | 'ccl';

export async function fetchExchangeRate(rateType: RateType): Promise<{ rateCents: bigint; date: Date }> {
  const res = await fetch('https://dolarapi.com/v1/dolares');
  if (!res.ok) {
    throw new Error(`Exchange rate API request failed with status ${res.status}`);
  }

  const body = await res.json();
  const entry = body[rateType];
  if (!entry || typeof entry.value_sell !== 'number') {
    throw new Error(`Exchange rate type "${rateType}" not found in API response`);
  }

  return {
    rateCents: BigInt(Math.round(entry.value_sell * 100)),
    date: new Date(),
  };
}
