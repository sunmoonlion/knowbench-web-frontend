import { useTranslations } from 'next-intl'
import type { FrozenScope } from '../api/formal-expert'

export function ScopePreview({ scope }: { scope: FrozenScope }) {
  const t = useTranslations('formalIntake')
  return (
    <section className="space-y-2" aria-label={t('scopeTitle')}>
      <h3 className="font-medium">{t('scopeTitle')}</h3>
      <ul className="list-disc pl-5">
        {scope.steps.map((step) => (
          <li key={step.id}>
            {step.id}
            {step.depends_on.length > 0 &&
              ' · ' + t('depends', { steps: step.depends_on.join(', ') })}
            {step.candidate_count > 1 &&
              ' · ' + t('candidateCount', { count: step.candidate_count })}
            {step.required_when && ' · ' + t('condition', { value: step.required_when })}
          </li>
        ))}
      </ul>
      {scope.inputs.length > 0 && (
        <>
          <h4>{t('inputs')}</h4>
          <ul>
            {scope.inputs.map((input) => (
              <li key={input.name}>
                {input.description} ({input.name}) ·{' '}
                {t('usedBy', { steps: input.used_by.join(', ') })}
                {input.required_by.length > 0 &&
                  ' · ' + t('requiredBy', { steps: input.required_by.join(', ') })}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>{t('outputs')}</h4>
      <ul>
        {scope.outputs.map((output) => (
          <li key={output.name}>
            {output.description} ({output.name}) · {output.step}
            {output.always_present !== undefined &&
              ' · ' + t(output.always_present ? 'guaranteedOutput' : 'conditionalOutput')}
          </li>
        ))}
      </ul>
      {scope.requirements.length > 0 && (
        <>
          <h4>{t('access')}</h4>
          <ul>
            {scope.requirements.map((req) => (
              <li key={req.id}>
                {req.capability} · v{req.version} · {req.operations.join(', ')}
                {req.resource_roles.length > 0 && (
                  <p>{t('resources', { roles: req.resource_roles.join(', ') })}</p>
                )}
                <p>
                  {req.purpose} · {req.destination}
                </p>
                {req.fields.length > 0 && <p>{t('fields', { fields: req.fields.join(', ') })}</p>}
                {scope.approvals
                  .filter((a) => a.requirement_id === req.id)
                  .map((a, i) => (
                    <p key={i}>
                      {t('approval', { operations: a.operations.join(', '), when: a.when })}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>{t('pendingExecution')}</p>
    </section>
  )
}
