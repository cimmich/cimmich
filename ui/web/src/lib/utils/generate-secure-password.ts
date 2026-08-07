const CHARACTER_SET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,.-{}+!#$%/()=?';
const UINT32_RANGE = 2 ** 32;

const secureRandomIndex = (upperBound: number) => {
  const largestUnbiasedRange = UINT32_RANGE - (UINT32_RANGE % upperBound);
  const sample = new Uint32Array(1);

  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= largestUnbiasedRange);

  return sample[0] % upperBound;
};

export const generateSecurePassword = (length: number = 16) => {
  let password = '';

  for (let index = 0; index < length; index++) {
    password += CHARACTER_SET[secureRandomIndex(CHARACTER_SET.length)];
  }

  return password;
};
