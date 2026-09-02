import { ArrowLeft, ArrowRight, Check } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ConversationNode } from "../api";

export interface ClarificationQuestion {
  id: string;
  label: string;
  question: string;
  required?: boolean;
  reason?: string;
  options: Array<{ value: string; label: string; description?: string }>;
  allowCustom?: boolean;
}

interface ClarificationAction {
  type?: string;
  summary?: string;
  questions?: ClarificationQuestion[];
}

interface ClarificationDockProps {
  node: ConversationNode;
  onSubmit: (nodeId: string, content: string) => void;
}

export function clarificationAction(node: ConversationNode): ClarificationAction | null {
  const action = node.metadata.terminalAction as ClarificationAction | undefined;
  return action?.questions?.length ? action : null;
}

export function ClarificationDock({ node, onSubmit }: ClarificationDockProps) {
  const action = clarificationAction(node)!;
  const questions = action.questions!;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setStep(0);
    setAnswers({});
    setCustomAnswers({});
  }, [node.id]);

  const current = questions[step];
  const selected = answers[current.id];
  const currentAnswer = selected === "__custom__" ? customAnswers[current.id]?.trim() : selected;
  const canContinue = !current.required || Boolean(currentAnswer);
  const isLast = step === questions.length - 1;

  const continueFlow = () => {
    if (!canContinue) return;
    if (!isLast) {
      setStep((value) => value + 1);
      return;
    }
    const content = questions.map((question) => {
      const value = answers[question.id] === "__custom__"
        ? customAnswers[question.id]?.trim()
        : answers[question.id];
      return `${question.label}：${value || "未指定"}`;
    }).join("\n");
    onSubmit(node.id, `确认需求表单结果：\n${content}`);
  };

  return (
    <section className="clarification-dock" aria-label="确认研究需求">
      <header className="clarification-dock-header">
        <div>
          <span>确认需求</span>
          <strong>{current.label}{current.required && <em>*</em>}</strong>
        </div>
        <div className="clarification-progress" aria-label={`第 ${step + 1} 个问题，共 ${questions.length} 个`}>
          <b>{step + 1}</b><span>/</span>{questions.length}
        </div>
      </header>

      <p className="clarification-question">{current.question}</p>
      <div className="dock-options" role="radiogroup" aria-label={current.label}>
        {(current.options ?? []).map((option) => (
          <label className={selected === option.value ? "selected" : ""} key={option.value}>
            <input
              type="radio" name={`${node.id}-${current.id}`} value={option.value}
              checked={selected === option.value}
              onChange={() => setAnswers((value) => ({ ...value, [current.id]: option.value }))}
            />
            <span><b>{option.label}</b>{option.description && <i>{option.description}</i>}</span>
            {selected === option.value && <Check weight="bold" />}
          </label>
        ))}
        {current.allowCustom !== false && (
          <label className={selected === "__custom__" ? "selected" : ""}>
            <input
              type="radio" name={`${node.id}-${current.id}`} value="__custom__"
              checked={selected === "__custom__"}
              onChange={() => setAnswers((value) => ({ ...value, [current.id]: "__custom__" }))}
            />
            <span><b>其他</b><i>没有合适选项时自行填写</i></span>
            {selected === "__custom__" && <Check weight="bold" />}
          </label>
        )}
      </div>

      {selected === "__custom__" && (
        <input
          className="dock-custom-answer" value={customAnswers[current.id] ?? ""}
          onChange={(event) => setCustomAnswers((value) => ({ ...value, [current.id]: event.target.value }))}
          placeholder="请输入你的具体需求…" autoFocus
        />
      )}
      {current.reason && <small className="dock-question-reason">{current.reason}</small>}
      {!current.required && !currentAnswer && <small className="dock-question-reason">此项可选，可以直接继续。</small>}

      <footer className="clarification-dock-actions">
        <button type="button" className="back" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>
          <ArrowLeft />上一步
        </button>
        <button type="button" className="continue" disabled={!canContinue} onClick={continueFlow}>
          {isLast ? "确认并继续研究" : "继续"}{isLast ? <Check /> : <ArrowRight />}
        </button>
      </footer>
    </section>
  );
}
