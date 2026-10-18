import type { ISODate } from './common';
import type { Group, Recipient } from './recipient';
import type { Template } from './template';

export interface ConfigList<T> { schemaVersion: 1; updatedAt: ISODate; items: T[] }

export interface ConfigWarnings { warnings: string[] }
export interface RecipientsSnapshot extends ConfigWarnings { recipients: Recipient[]; groups: Group[] }
export interface TemplatesSnapshot extends ConfigWarnings { templates: Template[] }
export type RecipientInput = Omit<Recipient, 'id' | 'updatedAt'> & { id?: string; groupIds?: string[] };
export type GroupInput = Omit<Group, 'id' | 'updatedAt' | 'isDefault'> & { id?: string };
export type TemplateInput = Omit<Template, 'id' | 'updatedAt' | 'isDefault'> & { id?: string };
