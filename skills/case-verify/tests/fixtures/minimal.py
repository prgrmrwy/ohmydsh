"""Generate two oracles, three checkpoints and five synthetic observations."""
from test_model_gates import ready_checking, append, observation, write_report


def build(root):
    root = ready_checking(root)
    records = [
        observation('C1', 'fail', actual='Saved value was not persisted'),
        observation('C1', 'pass', actual='Retest persistence verified after correction', supersedes='obs-0001'),
        observation('C2', 'blocked', actual='Synthetic account was unavailable'),
        observation('C2', 'pass', actual='Retest synthetic account now available', supersedes='obs-0003'),
        observation('C3', 'pass', actual='Derived affordance verified'),
    ]
    for record in records:
        result = append(root, record)
        if result.returncode:
            raise AssertionError(result.stderr)
    write_report(root)
    return root
