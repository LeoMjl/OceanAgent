export interface ProjectSshCredential {
  password: string;
}

export class ProjectCredentialVault {
  private readonly sshCredentials = new Map<string, ProjectSshCredential>();

  set(projectId: string, credential: ProjectSshCredential): void {
    this.sshCredentials.set(projectId, { ...credential });
  }

  get(projectId: string): ProjectSshCredential | undefined {
    const credential = this.sshCredentials.get(projectId);
    return credential ? { ...credential } : undefined;
  }

  has(projectId: string): boolean {
    return this.sshCredentials.has(projectId);
  }

  delete(projectId: string): void {
    this.sshCredentials.delete(projectId);
  }

  clear(): void {
    this.sshCredentials.clear();
  }
}
