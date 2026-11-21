export type VoiceName = "Kore" | "Zephyr" | "Puck" | "Charon" | "Fenrir";
export type VoiceSelection = string;

export type StudioMode = "single" | "dialogue";
export type ActiveTab = "studio" | "phrases" | "dialogue" | "library" | "guide";
export type IntensityLevel = "subtle" | "balanced" | "intense";
export type PaceLevel = "slow" | "natural" | "dynamic";
export type TtsEngine =
  | "gemini-3.8-flash-tts"
  | "gemini-3.8-flash-lite-tts"
  | "opensource-hf"
  | "opensource-endpoint";

export function isOpenSourceEngine(engine: TtsEngine): boolean {
  return engine === "opensource-hf" || engine === "opensource-endpoint";
}

export type CustomVoiceStorageMode = "project" | "local_key" | "opensource";
export type VoiceConsentLanguage = "es-ES" | "en-US";

export interface CustomVoiceProfile {
  id: string;
  ownerId: string;
  displayName: string;
  voiceToken: string; // "voice_...", "voicekey_...", or "osvoice_..."
  storageMode: CustomVoiceStorageMode;
  languageCode: VoiceConsentLanguage;
  createdAt: number;
  expireTime?: string;
  sampleAudioBase64?: string;
  referenceText?: string;
  durationSeconds?: number;
}

export type OpenSourceModelFamily = "auto" | "chatterbox" | "f5-tts" | "xtts";
export type OpenSourceProtocol = "auto" | "gradio" | "rest";
export type OpenSourceLanguage = "es" | "en" | "fr" | "pt";

export interface OpenSourcePublicConfig {
  hfSpaceId: string;
  hfModelFamily: OpenSourceModelFamily;
  endpointUrl: string;
  endpointProtocol: OpenSourceProtocol;
  endpointModelFamily: OpenSourceModelFamily;
  language: OpenSourceLanguage;
}

export const DEFAULT_OPENSOURCE_CONFIG: OpenSourcePublicConfig = {
  hfSpaceId: "ResembleAI/Chatterbox-Multilingual-TTS",
  hfModelFamily: "chatterbox",
  endpointUrl: "",
  endpointProtocol: "auto",
  endpointModelFamily: "auto",
  language: "es",
};

export interface HfSpacePreset {
  id: string;
  label: string;
  family: OpenSourceModelFamily;
  summary: string;
  needsRefText: boolean;
}

export const HF_SPACE_PRESETS: HfSpacePreset[] = [
  {
    id: "ResembleAI/Chatterbox-Multilingual-TTS",
    label: "Chatterbox Multilingüe (ResembleAI)",
    family: "chatterbox",
    summary: "Español nativo, clonación zero-shot con audio de 5–15 s sin requerir transcripción.",
    needsRefText: false,
  },
  {
    id: "ResembleAI/Chatterbox-Multilingual-TTS-V3",
    label: "Chatterbox Multilingüe V3 (Mirror oficial)",
    family: "chatterbox",
    summary: "Segunda instancia oficial de Chatterbox útil si el Space principal tiene cola.",
    needsRefText: false,
  },
  {
    id: "mrfakename/E2-F5-TTS",
    label: "E2-F5-TTS (F5-TTS comunitario)",
    family: "f5-tts",
    summary: "Clonación rápida con F5-TTS (requiere indicar la transcripción de referencia).",
    needsRefText: true,
  },
];

export const COLAB_CHATTERBOX_SNIPPET = `# Ejecuta esta celda en Google Colab (Entorno de ejecución: GPU T4 gratuita)
!pip install -q chatterbox-tts gradio torchaudio

import gradio as gr
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

model = ChatterboxMultilingualTTS.from_pretrained(device="cuda")

def generar_voz(text_input, language_id, audio_prompt_path_input):
    wav = model.generate(
        text_input,
        audio_prompt_path=audio_prompt_path_input,
        language_id=language_id or "es",
    )
    out_path = "/tmp/resonancia_colab.wav"
    ta.save(out_path, wav, model.sr)
    return out_path

demo = gr.Interface(
    fn=generar_voz,
    inputs=[
        gr.Textbox(label="text_input"),
        gr.Textbox(value="es", label="language_id"),
        gr.Audio(type="filepath", label="audio_prompt_path_input"),
    ],
    outputs=gr.Audio(type="filepath", label="output"),
)
demo.launch(share=True)`;

export interface VoiceCloningScriptOption {
  id: string;
  title: string;
  text: string;
}

export const VOICE_CONSENT_SCRIPTS: Record<
  VoiceConsentLanguage,
  { label: string; statement: string }
> = {
  "es-ES": {
    label: "Español (es-ES)",
    statement:
      "Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética.",
  },
  "en-US": {
    label: "English (en-US)",
    statement:
      "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.",
  },
};

export const VOICE_CLONING_SCRIPTS: VoiceCloningScriptOption[] = [
  {
    id: "natural-narracion",
    title: "Narración cálida y cercana (12–18 s)",
    text: "Hola, estoy grabando esta muestra con mi voz natural para crear locuciones expresivas. Me gusta hablar con calma, cuidando cada pausa y manteniendo un tono cercano, claro y auténtico en todo momento.",
  },
  {
    id: "lectura-expresiva",
    title: "Lectura dinámica y variada (15–20 s)",
    text: "Cuando cae la tarde sobre la ciudad, las luces se encienden poco a poco y todo parece respirar distinto. Hoy quiero probar cómo suena mi voz al contar historias, hacer preguntas con entusiasmo y compartir ideas con naturalidad.",
  },
  {
    id: "presentacion-directa",
    title: "Presentación informativa clara (12–16 s)",
    text: "Bienvenidos a este espacio de audio. Durante los próximos segundos estoy leyendo este texto a ritmo constante, con buena articulación y sin prisa, para capturar con fidelidad el timbre real de mi voz.",
  },
];

export type PhraseStatus = "pending" | "generating" | "ready" | "error";

export interface PhraseItem {
  id: string;
  text: string;
  status: PhraseStatus;
  audioBase64?: string;
  mimeType?: string;
  durationSeconds?: number;
  errorMessage?: string;
}

export interface VoiceProfile {
  id: VoiceName;
  name: string;
  timbre: string;
  register: string;
  idealFor: string;
  sampleLine: string;
}

export interface EmotionPreset {
  id: string;
  label: string;
  summary: string;
  stylePrompt: string;
}

export interface SampleScript {
  id: string;
  title: string;
  emotionId: string;
  voice: VoiceName;
  text: string;
  style: string;
}

export interface DialogueSpeaker {
  speaker: string;
  voiceName: VoiceSelection;
  emotionId: string;
  style: string;
}

export interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
}

export interface AudioTake {
  id: string;
  ownerId?: string;
  title: string;
  mode: StudioMode;
  voiceSummary: string;
  emotionLabel: string;
  styleUsed: string;
  scriptText: string;
  dialogueData?: {
    speakers: DialogueSpeaker[];
    lines: DialogueLine[];
  };
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
  modelUsed: string;
  createdAt: number;
  favorite: boolean;
}

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "Kore",
    name: "Kore",
    timbre: "Cálida y serena",
    register: "Registro medio femenino",
    idealFor: "Narración íntima, relatos emotivos y lectura pausada",
    sampleLine:
      "<breath> Hay palabras que solo cobran sentido cuando las decimos en voz alta, sin prisa.",
  },
  {
    id: "Zephyr",
    name: "Zephyr",
    timbre: "Luminosa y expresiva",
    register: "Registro medio-agudo",
    idealFor: "Entusiasmo genuino, podcasts dinámicos y storytelling vivo",
    sampleLine:
      "¡No sabes la ilusión que me da contarte esto! <laugh> Llevamos meses esperando este momento.",
  },
  {
    id: "Puck",
    name: "Puck",
    timbre: "Ágil y cercana",
    register: "Registro juvenil masculino",
    idealFor: "Conversación espontánea, humor cómplice y ritmo natural",
    sampleLine:
      "Espera, déjame respirar un segundo... <breath> ¿De verdad pensaste que iba a funcionar a la primera?",
  },
  {
    id: "Charon",
    name: "Charon",
    timbre: "Profunda y reflexiva",
    register: "Registro grave masculino",
    idealFor: "Crónicas documentales, reflexión nostálgica y gravedad dramática",
    sampleLine:
      "<breath> Cuando cayó la tarde sobre el puerto, comprendimos que aquel viaje nos había cambiado para siempre.",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    timbre: "Firme e intensa",
    register: "Registro barítono con carácter",
    idealFor: "Tensión escénica, discursos con convicción y emoción contenida",
    sampleLine:
      "Escúchame bien... <gasp> no tenemos una segunda oportunidad para hacer lo correcto hoy.",
  },
];

export const EMOTION_PRESETS: EmotionPreset[] = [
  {
    id: "warmth",
    label: "Calidez cercana",
    summary: "Tono amable, íntimo y conversacional",
    stylePrompt:
      "Warm, affectionate, close-mic conversational Spanish tone with gentle smiles in the voice and natural breathing",
  },
  {
    id: "joy",
    label: "Alegría vibrante",
    summary: "Entusiasmo luminoso y sonrisa audible",
    stylePrompt:
      "Bright, joyful, genuinely excited voice smiling warmly through the words with lively melodic inflection",
  },
  {
    id: "melancholy",
    label: "Melancolía íntima",
    summary: "Nostalgia suave con pausas contenidas",
    stylePrompt:
      "Soft, wistful, deeply nostalgic voice with tender emotional restraint, delicate sighs, and reflective pauses",
  },
  {
    id: "drama",
    label: "Tensión dramática",
    summary: "Peso escénico, urgencia y suspenso",
    stylePrompt:
      "Dramatic, intense, emotionally charged cinematic delivery with deliberate pauses and gripping urgency",
  },
  {
    id: "calm",
    label: "Calma contemplativa",
    summary: "Serenidad profunda y cadencia tranquila",
    stylePrompt:
      "Serene, soothing, meditative tone with unhurried phrasing, soft warmth, and tranquil rhythm",
  },
  {
    id: "tenderness",
    label: "Ternura y consuelo",
    summary: "Cuidado empático, casi al oído",
    stylePrompt:
      "Tender, empathetic, comforting voice full of care and softness, spoken gently as if reassuring a loved one",
  },
  {
    id: "wonder",
    label: "Asombro genuino",
    summary: "Curiosidad abierta y descubrimiento",
    stylePrompt:
      "Awestruck, curious, deeply inspired tone conveying genuine wonder and discovery",
  },
  {
    id: "irony",
    label: "Complicidad sutil",
    summary: "Ingenio cercano y tono desenfadado",
    stylePrompt:
      "Witty, playful, knowing conversational delivery with subtle dry humor and natural timing",
  },
];

export const SAMPLE_SCRIPTS: SampleScript[] = [
  {
    id: "carta",
    title: "Carta de reencuentro",
    emotionId: "melancholy",
    voice: "Kore",
    text: "<breath> Si estás escuchando esto, es porque al fin encontré el valor de decirte lo que guardé tantos años... No te escribo desde la tristeza, sino desde el agradecimiento por todo lo que fuimos.",
    style:
      "Voz íntima y conmovida, cercana al micrófono, con pausas delicadas y una ternura nostálgica genuina.",
  },
  {
    id: "buena-noticia",
    title: "Mensaje de alegría espontánea",
    emotionId: "joy",
    voice: "Zephyr",
    text: "¡No te lo vas a creer! <gasp> Acaban de confirmar el proyecto... <laugh> Perdona que hable tan rápido, es que todavía me tiemblan las manos de la emoción.",
    style:
      "Voz luminosa, sonriente y espontánea, con emoción auténtica desbordándose en cada frase.",
  },
  {
    id: "cronica",
    title: "Crónica nocturna",
    emotionId: "calm",
    voice: "Charon",
    text: "<breath> A las tres de la madrugada, la ciudad parece otra. Se apagan las prisas, baja el rumor del tráfico y queda apenas la luz tibia de alguna ventana encendida.",
    style:
      "Voz grave, serena y cinematográfica, con dicción pausada y atmósfera nocturna contemplativa.",
  },
  {
    id: "discurso",
    title: "Momento decisivo",
    emotionId: "drama",
    voice: "Fenrir",
    text: "Nos dijeron que era demasiado tarde... que nadie iba a escucharnos. <breath> Míranos ahora: no llegamos hasta aquí para quedarnos en silencio.",
    style:
      "Voz firme y apasionada, con tensión emocional contenida que crece hacia el final de la frase.",
  },
];

export const INITIAL_DIALOGUE_SPEAKERS: DialogueSpeaker[] = [
  {
    speaker: "Lucía",
    voiceName: "Kore",
    emotionId: "warmth",
    style: "Voz cercana, empática y con curiosidad genuina",
  },
  {
    speaker: "Mateo",
    voiceName: "Puck",
    emotionId: "joy",
    style: "Voz espontánea, expresiva y ligeramente sorprendida",
  },
];

export const INITIAL_DIALOGUE_LINES: DialogueLine[] = [
  {
    id: "line-1",
    speaker: "Lucía",
    text: "<breath> ¿De verdad dejaste todo listo anoche antes de viajar?",
  },
  {
    id: "line-2",
    speaker: "Mateo",
    text: "|mhm| Bueno, casi todo... <laugh> me quedé despierto hasta las dos revisando el último detalle.",
  },
  {
    id: "line-3",
    speaker: "Lucía",
    text: "Sabía que no ibas a dormir tranquilo hasta verlo terminado. Me alegra muchísimo por ti.",
  },
  {
    id: "line-4",
    speaker: "Mateo",
    text: "|yeah| Gracias de corazón... <breath> ahora sí siento que valió cada minuto.",
  },
];
