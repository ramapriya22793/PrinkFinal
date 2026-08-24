import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'printer' | 'customer';
  status: 'active' | 'inactive';
  lastLogin?: string;
}

export default function AdminUserManager() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'customer' as User['role'],
    status: 'active' as User['status'],
    password: ''
  });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setUsers(await res.json());
      } else {
        showToast('Failed to fetch users', 'error');
      }
    } catch (err) {
      showToast('Network error fetching users', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        status: user.status,
        password: '' // Don't populate password for editing, only if they want to reset
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        phone: '',
        role: 'customer',
        status: 'active',
        password: ''
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.email || !formData.role) {
      return showToast('Please fill required fields', 'warning');
    }
    if (!editingUser && !formData.password) {
      return showToast('Password is required for new users', 'warning');
    }

    try {
      const token = localStorage.getItem('admin_token');
      const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
      const method = editingUser ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        showToast(`User ${editingUser ? 'updated' : 'created'} successfully`, 'success');
        setShowModal(false);
        fetchUsers();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to save user', 'error');
      }
    } catch (err) {
      showToast('Network error saving user', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast('User deleted', 'success');
        fetchUsers();
      } else {
        showToast('Failed to delete user', 'error');
      }
    } catch (err) {
      showToast('Network error deleting user', 'error');
    }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.phone && u.phone.includes(search)) ||
    u.role.includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 h-100">
      <div className="flex align-center justify-between">
        <div>
          <h1 className="page-heading">User Management</h1>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Manage admins, printers, and customers</div>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <i className="bi bi-person-plus" /> Add User
        </button>
      </div>

      <div className="card p-4 flex flex-col gap-4 h-100" style={{ flex: 1, overflow: 'hidden' }}>
        <div className="flex align-center gap-3">
          <div className="input-group" style={{ flex: 1, maxWidth: 400 }}>
            <i className="bi bi-search" />
            <input 
              type="text" 
              className="input" 
              placeholder="Search by name, email, phone or role..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            Total Users: <strong>{users.length}</strong>
          </div>
        </div>

        <div className="table-container" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Loading users...
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                      No users found.
                    </td>
                  </tr>
                ) : filteredUsers.map(user => (
                  <tr key={user.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--primary)' }}>{user.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ID: {user.id}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13 }}><i className="bi bi-envelope" /> {user.email}</div>
                      {user.phone && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}><i className="bi bi-telephone" /> {user.phone}</div>}
                    </td>
                    <td>
                      <span className={`status-badge status-${user.role === 'admin' ? 'shipped' : user.role === 'printer' ? 'completed' : 'pending'}`}>
                        {user.role.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge status-${user.status === 'active' ? 'completed' : 'error'}`}>
                        {user.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-outline" style={{ marginRight: 8 }} onClick={() => handleOpenModal(user)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-sm btn-outline" style={{ color: 'var(--error)', borderColor: 'var(--error)' }} onClick={() => handleDelete(user.id)}>
                        <i className="bi bi-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)' }}>
              {editingUser ? 'Edit User' : 'Create User'}
            </h2>

            <div className="flex flex-col gap-4">
              <div className="grid grid-2 gap-4">
                <div>
                  <label className="label">Full Name *</label>
                  <input type="text" className="input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="John Doe" />
                </div>
                <div>
                  <label className="label">Role *</label>
                  <select className="input" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as any})}>
                    <option value="customer">Customer</option>
                    <option value="printer">Printer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Email Address *</label>
                <input type="email" className="input" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="email@example.com" />
              </div>

              <div>
                <label className="label">Phone Number (Optional)</label>
                <input type="text" className="input" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+91..." />
              </div>

              <div className="grid grid-2 gap-4">
                <div>
                  <label className="label">Account Status</label>
                  <select className="input" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as any})}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="label">{editingUser ? 'Reset Password' : 'Password *'}</label>
                  <input type="password" className="input" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder={editingUser ? 'Leave blank to keep current' : 'Min 6 characters'} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3" style={{ marginTop: '2rem' }}>
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>
                <i className="bi bi-check-lg" /> {editingUser ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
