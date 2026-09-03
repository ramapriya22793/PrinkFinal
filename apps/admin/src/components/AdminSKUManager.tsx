import React, { useState, useEffect } from 'react';
import type { SkuMapping } from '../types';

interface AdminSKUManagerProps {
  skuMappings: SkuMapping[];
  refreshMappings: () => Promise<void>;
  showToast: (msg: string, type: 'success'|'error'|'info'|'warning') => void;
}

export default function AdminSKUManager({ skuMappings, refreshMappings, showToast }: AdminSKUManagerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<SkuMapping>>({});
  const [search, setSearch] = useState('');
  
  const handleEdit = (sku: SkuMapping) => {
    setFormData(sku);
    setIsEditing(true);
  };

  const handleAddNew = () => {
    setFormData({
      status: 'active',
      supportedImageCount: 1,
      supportedFileTypes: ['PNG', 'JPEG'],
      maximumFileSize: 10,
      printAreaWidth: 10,
      printAreaHeight: 10,
      orientation: 'portrait'
    });
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sku || !formData.name || !formData.productType) {
      return showToast('SKU, Name, and Product Type are required', 'error');
    }
    
    try {
      const token = localStorage.getItem('admin_token');
      const isNew = !formData.id;
      const url = isNew ? '/api/skus' : `/api/skus/${formData.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        showToast('SKU saved successfully', 'success');
        setIsEditing(false);
        refreshMappings();
      } else {
        showToast('Failed to save SKU', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this SKU?')) return;
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/skus/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast('SKU deleted', 'success');
        refreshMappings();
      } else {
        showToast('Failed to delete SKU', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleImport = async () => {
    showToast('Import functionality would go here (CSV parsing).', 'info');
  };

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/skus/export', { headers: { 'Authorization': `Bearer ${token}` } });
      const json = await res.json();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(json.data, null, 2));
      const dlAnchorElem = document.createElement('a');
      dlAnchorElem.setAttribute("href", dataStr);
      dlAnchorElem.setAttribute("download", "sku_export.json");
      dlAnchorElem.click();
    } catch (err) {
      showToast('Export failed', 'error');
    }
  };

  const filtered = skuMappings.filter(s => 
    s.sku.toLowerCase().includes(search.toLowerCase()) || 
    (s.name && s.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="page-heading">SKU Management</h1>
          <p className="text-sm text-muted">Manage product SKUs, templates, and printing rules</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-outline" onClick={handleImport}><i className="bi bi-upload" /> Import</button>
          <button className="btn btn-outline" onClick={handleExport}><i className="bi bi-download" /> Export</button>
          <button className="btn btn-primary" onClick={handleAddNew}><i className="bi bi-plus-lg" /> Add New SKU</button>
        </div>
      </div>

      {isEditing ? (
        <div className="card p-6">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', background: '#eff6ff', padding: '12px 16px', borderRadius: '12px', border: '1px solid #bfdbfe', fontSize: '13px', color: '#1e40af' }}>
            <i className="bi bi-diagram-3-fill" style={{ fontSize: '18px' }} />
            <span><strong>Customization Rule Mapping Chain:</strong> Shopify SKU → Product Template → Required Photo Count → Customization Rules → Print Template</span>
          </div>

          <h2 style={{ marginBottom: '1rem' }}>{formData.id ? 'Edit SKU Mapping Rule' : 'Add New SKU Mapping Rule'}</h2>
          <form onSubmit={handleSave} className="grid grid-2 gap-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>1. Shopify SKU Code * (e.g. ABC123)</label>
              <input type="text" className="form-control" required placeholder="e.g. ABC123" value={formData.sku || ''} onChange={e => setFormData({...formData, sku: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Product Name *</label>
              <input type="text" className="form-control" required placeholder="e.g. 24-Page Photo Magazine" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>2. Product Template / Type *</label>
              <select className="form-control" required value={formData.productType || 'photobook'} onChange={e => setFormData({...formData, productType: e.target.value as import('../types').ProductType})}>
                <option value="photobook">Photo Magazine / Photobook</option>
                <option value="butterfly">Butterfly Box Frame</option>
                <option value="mug">Custom Photo Mug</option>
                <option value="tshirt">Custom T-Shirt</option>
                <option value="frame">Photo Frame</option>
                <option value="canvas">Canvas Print</option>
                <option value="pillow">Custom Cushion / Pillow</option>
                <option value="calendar">Custom Calendar</option>
                <option value="mobilecase">Mobile Case</option>
                <option value="keychain">Custom Keychain</option>
              </select>
            </div>
            <div className="form-group">
              <label>3. Required Photo Count (Photos needed from customer)</label>
              <input type="number" min="0" className="form-control" required value={formData.requiredPhotoCount ?? formData.supportedImageCount ?? 1} onChange={e => {
                const val = parseInt(e.target.value) || 0;
                setFormData({ ...formData, requiredPhotoCount: val, supportedImageCount: val, requiresCustomization: val > 0 });
              }} />
            </div>
            <div className="form-group">
              <label>4. Customization Rules / Upload Interface</label>
              <select className="form-control" value={formData.customizationRules || 'Photo Magazine 24-Page Layout'} onChange={e => setFormData({...formData, customizationRules: e.target.value})}>
                <option value="Photo Magazine 24-Page Layout">Photo Magazine 24-Page Layout</option>
                <option value="Butterfly Box 4-Slot Frame">Butterfly Box 4-Slot Frame</option>
                <option value="Single High-Res Photo Upload">Single High-Res Photo Upload</option>
                <option value="Multi-Photo Collage (2-6 Photos)">Multi-Photo Collage (2-6 Photos)</option>
                <option value="Freeform Design Studio">Freeform Design Studio</option>
                <option value="No Customization (Direct Print)">No Customization (Direct Print)</option>
              </select>
            </div>
            <div className="form-group">
              <label>5. Print Template (Target for Printer Portal)</label>
              <input type="text" className="form-control" placeholder="e.g. Magazine Print Template" value={formData.printTemplate || formData.templateName || ''} onChange={e => setFormData({...formData, printTemplate: e.target.value, templateName: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Print Area Width (inches)</label>
              <input type="number" step="0.1" className="form-control" value={formData.printAreaWidth || ''} onChange={e => setFormData({...formData, printAreaWidth: parseFloat(e.target.value)})} />
            </div>
            <div className="form-group">
              <label>Print Area Height (inches)</label>
              <input type="number" step="0.1" className="form-control" value={formData.printAreaHeight || ''} onChange={e => setFormData({...formData, printAreaHeight: parseFloat(e.target.value)})} />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Printer Operator Instructions</label>
              <textarea className="form-control" placeholder="Instructions that will appear in Printer Portal" value={formData.printingInstructions || ''} onChange={e => setFormData({...formData, printingInstructions: e.target.value})}></textarea>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select className="form-control" value={formData.status || 'active'} onChange={e => setFormData({...formData, status: e.target.value})}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1', display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button type="submit" className="btn btn-primary"><i className="bi bi-check-lg" /> Save SKU Rule Mapping</button>
              <button type="button" className="btn btn-outline" onClick={() => setIsEditing(false)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <input type="text" className="form-control" placeholder="Search by SKU, Name or Template..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: '340px' }} />
            <span className="text-xs text-muted">Showing {filtered.length} configured SKU mappings</span>
          </div>
          <div className="table-wrapper card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shopify SKU</th>
                  <th>Product Name</th>
                  <th>Product Template</th>
                  <th>Required Photos</th>
                  <th>Customization Rules</th>
                  <th>Print Template</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sku => (
                  <tr key={sku.id || sku.sku}>
                    <td><strong style={{ fontFamily: 'monospace', fontSize: '13px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px' }}>{sku.sku}</strong></td>
                    <td>{sku.name}</td>
                    <td><span className="badge badge-outline">{sku.productType}</span></td>
                    <td><span className="badge badge-info" style={{ fontWeight: 700 }}>{sku.requiredPhotoCount ?? sku.supportedImageCount ?? 1} Photos</span></td>
                    <td><span className="text-xs font-semibold text-muted">{sku.customizationRules || 'Standard Upload'}</span></td>
                    <td><span className="badge badge-primary" style={{ background: '#171C62' }}>{sku.printTemplate || sku.templateName || 'Standard'}</span></td>
                    <td><span className={`badge ${sku.status === 'active' ? 'bg-success' : 'bg-secondary'}`}>{sku.status}</span></td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-sm btn-outline" onClick={() => handleEdit(sku)} title="Edit SKU Mapping"><i className="bi bi-pencil" /></button>
                        <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(sku.id || sku.sku)} title="Delete SKU Mapping"><i className="bi bi-trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>No SKU Mappings found. Click <strong>Add New SKU</strong> to configure one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


