/**
 * Style ids used by `xlsx.ts`'s fixed style table. Shared by the public free
 * workbook and the operator-private full workbook so both look like one product.
 */
export const SHEET_STYLE = {
  default: 0,
  title: 1,
  header: 2,
  inputMoney: 3,
  inputInt: 4,
  resultMoney: 5,
  resultPercent: 6,
  note: 7,
  sampleText: 8,
  bold: 9,
  textWrap: 10,
  dateInput: 11,
  status: 12,
  totalMoney: 13,
  inputPercent: 14,
  label: 15,
  headerLeft: 16,
  sampleMoney: 17,
  samplePercent: 18,
  section: 19,
  center: 20,
  inputText: 21,
  instruction: 22,
  totalLabel: 23,
  plainMoney: 24,
  plainPercent: 25
} as const;
