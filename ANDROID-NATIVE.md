# Azurecord Android nativo

Este documento define a migração do cliente móvel do Azurecord para um APK Android real, sem depender de instalação PWA.

## Objetivo

Manter a interface web atual onde ela já funciona bem, mas mover as partes que precisam de APIs de sistema para uma camada Android nativa.

### Continua no frontend web

- login e sessão Azurecord Cloud
- DMs, servidores, mensagens e anexos
- WebSocket de presença/mensagens
- telas, temas e configurações
- sinalização de chamada via Azurecord API / Realtime

### Vai para a camada Android nativa

- microfone e câmera durante AzureCall
- captura de tela
- MediaProjection
- WebRTC PeerConnection e trilhas de mídia
- áudio de chamada
- notificação/foreground service durante compartilhamento
- renderização do vídeo remoto/local

## Compartilhamento de tela

Um APK nativo não deve tentar abrir o seletor do Chrome. O fluxo correto é o seletor do próprio Android via MediaProjection.

Fluxo:

1. JavaScript solicita `screenShare.start` para a bridge nativa.
2. Kotlin chama `MediaProjectionManager.createScreenCaptureIntent()`.
3. Android exibe a confirmação de compartilhamento para o usuário.
4. Depois do consentimento, o app inicia um foreground service do tipo `mediaProjection`.
5. A camada WebRTC nativa cria uma trilha de tela usando o resultado da MediaProjection.
6. SDP/ICE continuam passando pela sinalização Azurecord já existente.
7. Ao parar a transmissão ou encerrar a chamada, a projeção e o foreground service são encerrados imediatamente.

Em Android 14+, o seletor do sistema também pode permitir compartilhar apenas um aplicativo em vez da tela inteira.

## Bridge JS ↔ Android

Eventos mínimos:

### JS para Android

- `call.start({ peerId, callId, type })`
- `call.accept({ peerId, callId, type })`
- `call.remoteDescription({ callId, description })`
- `call.remoteIce({ callId, candidate })`
- `call.mic({ enabled })`
- `call.camera({ enabled })`
- `screenShare.start({ callId })`
- `screenShare.stop({ callId })`
- `call.end({ callId })`

### Android para JS

- `call.localDescription`
- `call.localIce`
- `call.state`
- `screenShare.state`
- `screenShare.permissionDenied`
- `call.error`

A bridge deve usar mensagens estruturadas e validar origem/tipo dos eventos. Não passar tokens ou secrets TURN por logs.

## ICE / TURN

O cliente 2.0.3 busca `GET /api/realtime/ice-servers`.

- Sem TURN configurado, a API devolve STUN de fallback.
- Com `TURN_KEY_ID` e `TURN_KEY_API_TOKEN`, a API gera credenciais TURN temporárias no servidor.
- A chave longa nunca vai para o browser, Electron ou APK.
- O mesmo endpoint pode ser reutilizado pelo WebRTC nativo no Android.

## Permissões Android

O manifesto final deve declarar somente o necessário, incluindo:

- `android.permission.INTERNET`
- `android.permission.RECORD_AUDIO`
- `android.permission.CAMERA`
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION` nas versões em que for exigido
- notificação conforme a versão/target do Android

A autorização de MediaProjection é pedida pelo sistema a cada sessão de captura; não deve ser armazenada como uma permissão permanente.

## Estrutura recomendada

```text
android/
  app/
    src/main/
      java/.../
        MainActivity.kt
        bridge/AzurecordBridge.kt
        call/AzureCallNative.kt
        call/AzureCallForegroundService.kt
        call/AzureScreenCapturer.kt
      AndroidManifest.xml
```

A primeira etapa do APK pode carregar a interface atual em uma WebView controlada pelo aplicativo. Isso já remove a dependência de instalação PWA. A segunda etapa move AzureCall para Kotlin/libwebrtc, mantendo o resto da interface e da sinalização compartilhados com Web/Desktop.

## Critério para considerar o Android pronto

- Web, Desktop e Android recebem a mesma DM em tempo real.
- chamada voz/vídeo funciona em Wi-Fi ↔ Wi-Fi, Wi-Fi ↔ 4G/5G e 4G/5G ↔ 4G/5G.
- TURN é usado quando conexão direta não é possível.
- compartilhar tela sempre abre confirmação do Android.
- iniciar/parar compartilhamento atualiza o outro participante sem reiniciar a chamada.
- aviso de transmissão abre a tela remota.
- encerrar chamada remove captura, microfone/câmera e foreground service.
