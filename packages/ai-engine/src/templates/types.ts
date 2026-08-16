export interface DictionaryItem {
  variant: string;
  normalized_form: string;
  meaning: string;
  intent_hint: string;
  frequency: number;
}

export interface RouterCompactItem {
  intent: string;
  patterns: string[];
  entities: string[];
  answer_mode: 'STATIC_TEMPLATE' | 'DYNAMIC_DATABASE';
  template_id: string;
  handoff: boolean;
}

export interface TemplateQAItem {
  intent_id: string;
  canonical_question: string;
  customer_variants: string[];
  required_entities: string[];
  optional_entities: string[];
  answer_mode: 'STATIC_TEMPLATE' | 'DYNAMIC_DATABASE';
  required_data: string[];
  answer_templates: {
    default?: string;
    unknown?: string;
    [key: string]: string | undefined;
  };
  follow_up: string | null;
  lead_signal: 'HOT' | 'WARM' | 'COLD' | 'NONE';
  handoff: boolean;
  confidence: number;
  thresholds: {
    deterministic: number;
    confirm: number;
    fallback_below: number;
  };
}

export interface ExtractedEntities {
  product?: string;
  quantity?: string;
  color?: string;
  location?: string;
  order_reference?: string;
  [key: string]: string | undefined;
}

export interface TemplateMatchResult {
  intentId: string;
  templateId: string;
  answerMode: 'STATIC_TEMPLATE' | 'DYNAMIC_DATABASE';
  confidence: number;
  route: 'DETERMINISTIC' | 'CONFIRM' | 'FALLBACK';
  extractedEntities: ExtractedEntities;
  matchedPattern?: string;
  leadSignal: 'HOT' | 'WARM' | 'COLD' | 'NONE';
  handoff: boolean;
  requiredEntitiesMissing: boolean;
}
