export const RESEARCH_FIELD_NAMES = {
  D0601: "物理海洋学",
  D0602: "海洋化学",
  D0603: "海洋地质学与地球物理学",
  D0604: "生物海洋学与海洋生物资源",
  D0605: "海洋生态学与环境科学",
  D0606: "河口海岸学",
  D0607: "海洋遥感",
  D0608: "海洋物理与观测探测技术",
  D0609: "海洋数据科学与信息系统",
  D0610: "海洋系统与全球变化",
  D0611: "海洋工程与环境效应",
  D0612: "海洋灾害与防灾减灾",
  D0613: "海洋能源与资源",
  D0614: "海陆统筹与可持续发展",
  D0615: "极地科学",
} as const;

export type ResearchFieldCode = keyof typeof RESEARCH_FIELD_NAMES;

export const RESEARCH_FIELD_CODES = Object.keys(RESEARCH_FIELD_NAMES) as ResearchFieldCode[];

export function researchFieldLabel(code: string): string {
  return code in RESEARCH_FIELD_NAMES
    ? `${code} ${RESEARCH_FIELD_NAMES[code as ResearchFieldCode]}`
    : code;
}
