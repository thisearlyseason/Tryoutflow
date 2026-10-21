'use client';

import { useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';

export function OrganizationNameFields() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [editedAddress, setEditedAddress] = useState(false);
  return (
    <>
      <FormField htmlFor="name" label="Organization name" required>
        {({ describedBy }) => (
          <Input
            aria-describedby={describedBy}
            id="name"
            name="name"
            placeholder={FIELD_EXAMPLES.organizationName}
            required
            value={name}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!editedAddress)
                setSlug(
                  next
                    .toLowerCase()
                    .normalize('NFKD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, ''),
                );
            }}
          />
        )}
      </FormField>
      <FormField
        description="We suggest an internal workspace address from your name. You can edit it; this is not your public website."
        htmlFor="slug"
        label="Workspace address"
        required
      >
        {({ describedBy }) => (
          <Input
            aria-describedby={describedBy}
            id="slug"
            name="slug"
            required
            value={slug}
            onChange={(event) => {
              setEditedAddress(true);
              setSlug(event.target.value);
            }}
          />
        )}
      </FormField>
    </>
  );
}
