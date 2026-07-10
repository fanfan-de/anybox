export type TextGenerationUndoRecord = {
  nodeID: string
  previousText: string
  generatedText: string
  expiresAt: number
}

export function canRestoreGeneratedText(
  record: TextGenerationUndoRecord,
  currentText: string | null | undefined,
  now = Date.now(),
): boolean {
  return now <= record.expiresAt && currentText === record.generatedText
}
