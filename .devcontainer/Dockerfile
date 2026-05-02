FROM mcr.microsoft.com/devcontainers/typescript-node:20-bookworm

# nodeユーザーをvscodeにリネーム（UID/GIDは1000のまま維持）
RUN usermod -l vscode node \
    && groupmod -n vscode node \
    && usermod -d /home/vscode -m vscode \
    && echo "vscode ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vscode \
    && chmod 0440 /etc/sudoers.d/vscode
