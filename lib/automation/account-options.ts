/** WP1.6: turns a synced chart of accounts (WP1.5's AccountingEntity rows) into the option list
 * for the supplier-rule form's account picker. The submitted `value` is the code when the
 * provider has one (QuickBooks accounts carry no separate code, so `code` is null there and the
 * name is used for both value and label); `label` always shows code + name together when both
 * exist, for a person picking from the list. */
export function resolveAccountOptions(accountingEntities: { code: string | null; name: string }[]): { value: string; label: string }[] {
  return accountingEntities.map((entity) => ({
    value: entity.code ?? entity.name,
    label: entity.code ? `${entity.code} — ${entity.name}` : entity.name,
  }))
}
