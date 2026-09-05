import {
  createRoutingRuleAction,
  deleteRoutingRuleAction,
  moveRoutingRuleAction,
  toggleRoutingRuleAction,
} from "@/app/actions/routing";
import { listAgents } from "@/lib/agents";
import { requireOwner } from "@/lib/auth";
import { listQueues } from "@/lib/queues";
import { listRoutingRules } from "@/lib/routing";

export default async function RoutingRulesPage() {
  const session = await requireOwner();
  const rules = await listRoutingRules(session.orgId);
  const queues = await listQueues(session.orgId);
  const agents = await listAgents(session.orgId);

  return (
    <div className="container routing-container">
      <div className="settings-header">
        <h1 className="page-title">Automated Routing Rules</h1>
        <p className="page-subtitle">
          Rules run on new tickets in order from top to bottom. The first active rule matching
          the ticket sets its queue, assignee, or priority.
        </p>
      </div>

      {/* Existing Rules Table */}
      <div className="card card-pad mb-6">
        <h2 className="card-heading mb-3">Configured Rules ({rules.length})</h2>

        {rules.length === 0 ? (
          <p className="muted">No routing rules created yet. Add your first rule below.</p>
        ) : (
          <table className="table routing-table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>Order</th>
                <th>Rule Name</th>
                <th>Condition</th>
                <th>Actions</th>
                <th>Status</th>
                <th style={{ width: "160px" }}>Manage</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, idx) => (
                <tr key={rule.id}>
                  <td className="font-mono text-sm">#{idx + 1}</td>
                  <td>
                    <div className="font-semibold">{rule.name}</div>
                    {rule.description && (
                      <div className="muted text-xs">{rule.description}</div>
                    )}
                  </td>
                  <td>
                    <span className="font-mono text-xs rule-condition-tag">
                      {rule.match_field} {rule.match_operator} &quot;{rule.match_value}&quot;
                    </span>
                  </td>
                  <td>
                    <div className="rule-actions-stack">
                      {rule.target_queue_name && (
                        <span className="badge badge-neutral">
                          Queue: {rule.target_queue_name}
                        </span>
                      )}
                      {rule.target_agent_name && (
                        <span className="badge badge-neutral">
                          Assignee: {rule.target_agent_name}
                        </span>
                      )}
                      {rule.target_priority && (
                        <span className="badge badge-warning uppercase text-xs">
                          {rule.target_priority}
                        </span>
                      )}
                      {!rule.target_queue_name &&
                        !rule.target_agent_name &&
                        !rule.target_priority && (
                          <span className="muted text-xs">None</span>
                        )}
                    </div>
                  </td>
                  <td>
                    <form action={toggleRoutingRuleAction}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <button
                        type="submit"
                        className={`badge ${
                          rule.is_active ? "badge-success" : "badge-neutral"
                        } cursor-pointer`}
                        title="Click to toggle active state"
                      >
                        {rule.is_active ? "Active" : "Disabled"}
                      </button>
                    </form>
                  </td>
                  <td>
                    <div className="row-actions">
                      <form action={moveRoutingRuleAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={idx === 0}
                          className="btn-icon"
                          title="Move Up"
                        >
                          ↑
                        </button>
                      </form>

                      <form action={moveRoutingRuleAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={idx === rules.length - 1}
                          className="btn-icon"
                          title="Move Down"
                        >
                          ↓
                        </button>
                      </form>

                      <form action={deleteRoutingRuleAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <button
                          type="submit"
                          className="btn-icon btn-icon-danger"
                          title="Delete Rule"
                        >
                          ✕
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add New Rule Form */}
      <div className="card card-pad">
        <h2 className="card-heading mb-4">Add Routing Rule</h2>
        <form action={createRoutingRuleAction} className="rule-form">
          <div className="form-group mb-3">
            <label htmlFor="name" className="form-label">
              Rule Name *
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="e.g. Route billing questions to Finance"
              className="form-input"
            />
          </div>

          <div className="form-group mb-3">
            <label htmlFor="description" className="form-label">
              Description (Optional)
            </label>
            <input
              id="description"
              name="description"
              type="text"
              placeholder="e.g. Catches keywords related to invoice, billing, payment"
              className="form-input"
            />
          </div>

          <fieldset className="condition-fieldset mb-4">
            <legend className="condition-legend">If incoming ticket matches:</legend>
            <div className="condition-row">
              <div className="condition-col">
                <label htmlFor="matchField" className="form-label text-xs">
                  Field
                </label>
                <select id="matchField" name="matchField" className="form-select">
                  <option value="subject">Subject</option>
                  <option value="body">Body / Description</option>
                  <option value="requester_email">Requester Email</option>
                </select>
              </div>

              <div className="condition-col">
                <label htmlFor="matchOperator" className="form-label text-xs">
                  Operator
                </label>
                <select id="matchOperator" name="matchOperator" className="form-select">
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="starts_with">starts with</option>
                  <option value="ends_with">ends with</option>
                </select>
              </div>

              <div className="condition-col flex-2">
                <label htmlFor="matchValue" className="form-label text-xs">
                  Value *
                </label>
                <input
                  id="matchValue"
                  name="matchValue"
                  type="text"
                  required
                  placeholder="e.g. invoice or @enterprise.com"
                  className="form-input"
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="condition-fieldset mb-4">
            <legend className="condition-legend">Then apply actions:</legend>
            <div className="actions-row">
              <div className="action-col">
                <label htmlFor="targetQueueId" className="form-label text-xs">
                  Assign Queue
                </label>
                <select id="targetQueueId" name="targetQueueId" className="form-select">
                  <option value="">(No change)</option>
                  {queues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="action-col">
                <label htmlFor="targetAgentId" className="form-label text-xs">
                  Assign Agent
                </label>
                <select id="targetAgentId" name="targetAgentId" className="form-select">
                  <option value="">(No change)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="action-col">
                <label htmlFor="targetPriority" className="form-label text-xs">
                  Set Priority
                </label>
                <select id="targetPriority" name="targetPriority" className="form-select">
                  <option value="">(No change)</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
          </fieldset>

          <button type="submit" className="btn btn-primary">
            Create Rule
          </button>
        </form>
      </div>
    </div>
  );
}
