export type InstalledApp = {
  name: string; // الاسم الظاهر على الجوال
  pkg: string; // اسم الحزمة (المعرّف الداخلي)
};

export type SpeechSource = 'app' | 'bubble';
export type SpeechResultEvent = { text: string; alternatives: string; source: SpeechSource }; // alternatives مفصولة بـ |
export type SpeechStateEvent = { state: 'listening' | 'hearing' | 'processing' | 'idle'; source: SpeechSource };
export type SpeechErrorEvent = { code: number; message: string; source: SpeechSource };
// البصمة لم تثق — تتولى جوجل الاحتياطية
export type VoiceNoMatchEvent = { source: SpeechSource; distance: number; threshold: number };
export type VoicePrint = { id: string; pkg: string; phrase: string };

export type SpeechEvents = {
  onSpeechResult(e: SpeechResultEvent): void;
  onSpeechState(e: SpeechStateEvent): void;
  onSpeechError(e: SpeechErrorEvent): void;
  onVoiceNoMatch(e: VoiceNoMatchEvent): void;
};
