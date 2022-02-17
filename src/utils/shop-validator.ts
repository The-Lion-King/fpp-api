
export default function validateShop(shop: string): boolean {
  const shopUrlRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myfunpinpin\.(com|top)[/]*$/;
  return shopUrlRegex.test(shop);
}
