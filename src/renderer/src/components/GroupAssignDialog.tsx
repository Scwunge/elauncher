import { useEffect, useState } from 'react'
import type { ModpackGroup } from '../types'

interface Props {
  modpackId: string
  modpackName: string
  currentGroupId?: string
  onClose: () => void
  /** Called after any change (assign/unassign/create) so the caller can refresh its own
   *  groups+assignments state without this dialog needing to own that state itself. */
  onChanged: () => void
}

export default function GroupAssignDialog({ modpackId, modpackName, currentGroupId, onClose, onChanged }: Props) {
  const [groups, setGroups] = useState<ModpackGroup[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.groups.list().then(setGroups)
  }, [])

  async function assign(groupId: string | undefined) {
    setSaving(true)
    await window.api.groups.assign(modpackId, groupId)
    setSaving(false)
    onChanged()
  }

  async function createAndAssign() {
    if (!newGroupName.trim()) return
    setSaving(true)
    const group = await window.api.groups.create(newGroupName.trim())
    await window.api.groups.assign(modpackId, group.id)
    setNewGroupName('')
    setSaving(false)
    onChanged()
    onClose()
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Move to group</h2>
        <p className="field-hint">{modpackName}</p>

        <div className="field">
          <label className="radio-label">
            <input
              type="radio"
              name="group-pick"
              checked={!currentGroupId}
              disabled={saving}
              onChange={() => assign(undefined)}
            />
            Ungrouped
          </label>
          {groups.map((g) => (
            <div className="row" key={g.id} style={{ alignItems: 'center' }}>
              <label className="radio-label" style={{ flex: 1 }}>
                <input
                  type="radio"
                  name="group-pick"
                  checked={currentGroupId === g.id}
                  disabled={saving}
                  onChange={() => assign(g.id)}
                />
                {g.name}
              </label>
              <button
                className="icon-button"
                title="Rename group"
                onClick={async () => {
                  const name = prompt('Rename group', g.name)
                  if (name && name.trim()) {
                    await window.api.groups.rename(g.id, name.trim())
                    window.api.groups.list().then(setGroups)
                    onChanged()
                  }
                }}
              >
                ✎
              </button>
              <button
                className="icon-button"
                title="Delete group (instances become ungrouped)"
                onClick={async () => {
                  if (confirm(`Delete group "${g.name}"? Modpacks in it just become ungrouped.`)) {
                    await window.api.groups.remove(g.id)
                    window.api.groups.list().then(setGroups)
                    onChanged()
                  }
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        <div className="field">
          <label>New group</label>
          <div className="row">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
            />
            <button disabled={saving || !newGroupName.trim()} onClick={createAndAssign}>
              Create &amp; move here
            </button>
          </div>
        </div>

        <div className="settings-actions">
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
