v3Cnpj = function (value) {
  const cnpj = v3Digits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const digit = (base) => {
    let weight = base.length - 7;
    let sum = 0;
    for (const ch of base) {
      sum += Number(ch) * weight--;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = digit(cnpj.slice(0, 12));
  if (first !== Number(cnpj[12])) return false;
  const second = digit(cnpj.slice(0, 12) + first);
  return second === Number(cnpj[13]);
};
