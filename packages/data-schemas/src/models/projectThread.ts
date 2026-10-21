import { Model } from 'mongoose';
import type { IProjectThreadDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import projectThreadSchema from '~/schema/projectThread';

export function createProjectThreadModel(
  mongoose: typeof import('mongoose'),
): Model<IProjectThreadDocument> {
  applyTenantIsolation(projectThreadSchema);
  return (
    mongoose.models.ProjectThread ||
    mongoose.model<IProjectThreadDocument>('ProjectThread', projectThreadSchema, 'projectthreads')
  );
}
