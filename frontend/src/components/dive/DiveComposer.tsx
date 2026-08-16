import { Icon } from "../shared/Icon";
import { MessageInput } from "./MessageInput";
import { FORGETTING_BUDGET_MAX } from "../../constants";

interface DiveComposerProps {
    error: string | null;
    onClearError: () => void;
    onSend: (text: string) => void;
    disabled: boolean;
    budgetUsed: number;
    budgetMax: number;
}

export function DiveComposer({
    error,
    onClearError,
    onSend,
    disabled,
    budgetUsed,
    budgetMax,
}: DiveComposerProps) {
    return (
        <div className="dive-composer">
            {error && (
                <div role="alert" className="dive-error fx-rise">
                    <span className="dive-error-icon">
                        <Icon name="close" size={11} />
                    </span>
                    <p className="dive-error-text">{error}</p>
                    <button onClick={onClearError} className="dive-error-dismiss">
                        dismiss
                    </button>
                </div>
            )}
            <MessageInput onSend={onSend} disabled={disabled} />
            <div className="composer-hints">
                <span>memories auto-inject</span>
                <span>esc dismisses panels</span>
                <span className="count">
                    budget {budgetUsed}/{budgetMax || FORGETTING_BUDGET_MAX}
                </span>
            </div>
        </div>
    );
}