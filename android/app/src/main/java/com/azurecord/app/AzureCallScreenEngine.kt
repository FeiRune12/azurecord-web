package com.azurecord.app

import android.app.Service
import android.content.Intent
import android.media.projection.MediaProjection
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt

class AzureCallScreenEngine(
    private val service: Service,
    private val resultCode: Int,
    private val projectionData: Intent,
    val callId: String,
    private val peerId: String,
    private val token: String,
    private val onState: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
    private val onStopped: () -> Unit
) {
    companion object {
        private const val API_BASE = "https://azurecord-api.giovannisilvaalves604.workers.dev"
        private const val REALTIME_WS = "wss://azurecord-realtime.giovannisilvaalves604.workers.dev/ws"
        private val factoryInitialized = AtomicBoolean(false)
    }

    private val stopping = AtomicBoolean(false)
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val http = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    @Volatile private var webSocketReady = false
    private var signalCursor = System.currentTimeMillis() - 5_000L
    private var pollTick = 0
    private val seenSignalIds = LinkedHashSet<String>()

    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private val pendingRemoteIce = mutableListOf<IceCandidate>()
    @Volatile private var remoteDescriptionReady = false

    fun start() {
        executor.execute {
            try {
                connectRealtime()
                startWebRtc()
                executor.scheduleWithFixedDelay(
                    { safePollSignals() },
                    800,
                    800,
                    TimeUnit.MILLISECONDS
                )
            } catch (error: Exception) {
                fail(error.message ?: "O WebRTC nativo não conseguiu iniciar.")
            }
        }
    }

    private fun startWebRtc() {
        if (factoryInitialized.compareAndSet(false, true)) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions
                    .builder(service.applicationContext)
                    .createInitializationOptions()
            )
        }

        egl = EglBase.create()
        val eglContext = requireNotNull(egl).eglBaseContext

        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglContext))
            .createPeerConnectionFactory()

        val rtcConfig = PeerConnection.RTCConfiguration(fetchIceServers()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }

        peerConnection = factory?.createPeerConnection(rtcConfig, peerObserver())
            ?: throw IllegalStateException("O Android não conseguiu criar a conexão WebRTC da tela.")

        capturer = ScreenCapturerAndroid(
            projectionData,
            object : MediaProjection.Callback() {
                override fun onStop() {
                    stop("projection-ended")
                }
            }
        )

        videoSource = factory?.createVideoSource(true)
            ?: throw IllegalStateException("Não foi possível criar a fonte de vídeo da tela.")

        surfaceTextureHelper = SurfaceTextureHelper.create("AzurecordScreenCapture", eglContext)
        capturer?.initialize(
            surfaceTextureHelper,
            service.applicationContext,
            requireNotNull(videoSource).capturerObserver
        )

        val metrics = service.resources.displayMetrics
        val sourceWidth = max(1, metrics.widthPixels)
        val sourceHeight = max(1, metrics.heightPixels)
        val longestSide = max(sourceWidth, sourceHeight)
        val scale = minOf(1.0, 1280.0 / longestSide.toDouble())
        val width = max(2, ((sourceWidth * scale).roundToInt() / 2) * 2)
        val height = max(2, ((sourceHeight * scale).roundToInt() / 2) * 2)

        capturer?.startCapture(width, height, 20)

        videoTrack = factory?.createVideoTrack("AZURECORD_NATIVE_SCREEN", videoSource)
        videoTrack?.setEnabled(true)
        peerConnection?.addTrack(videoTrack, listOf("azurecord-native-screen"))

        createOffer()
        onState(true)
        sendSignal("screen-share-start")
    }

    private fun createOffer() {
        val pc = requireNotNull(peerConnection)
        pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(description: SessionDescription) {
                executor.execute {
                    pc.setLocalDescription(object : SimpleSdpObserver() {
                        override fun onSetSuccess() {
                            sendSignal("native-screen-offer", description = description)
                        }

                        override fun onSetFailure(error: String) {
                            fail("Falha ao publicar a oferta de tela: " + error)
                        }
                    }, description)
                }
            }

            override fun onCreateFailure(error: String) {
                fail("Falha ao criar a oferta de tela: " + error)
            }
        }, org.webrtc.MediaConstraints())
    }

    private fun peerObserver() = object : PeerConnection.Observer {
        override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit

        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
            if (newState == PeerConnection.IceConnectionState.FAILED) {
                fail("A conexão WebRTC da transmissão falhou.")
            }
        }

        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit

        override fun onIceCandidate(candidate: IceCandidate) {
            executor.execute { sendSignal("native-screen-ice", candidate = candidate) }
        }

        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(dataChannel: DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) = Unit
    }

    private fun connectRealtime() {
        val request = Request.Builder()
            .url(REALTIME_WS)
            .header("Sec-WebSocket-Protocol", "azurecord-v1." + token)
            .build()

        webSocket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocketReady = true
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                executor.execute {
                    try {
                        val root = JSONObject(text)
                        if (root.optString("type") != "call.signal") return@execute
                        if (root.optString("fromUserId") != peerId) return@execute
                        handleSignal(root.optJSONObject("signal"))
                    } catch (_: Exception) {
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                webSocketReady = false
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                webSocketReady = false
            }
        })
    }

    private fun sendSignal(
        kind: String,
        description: SessionDescription? = null,
        candidate: IceCandidate? = null
    ) {
        if (stopping.get() && kind != "native-screen-stop" && kind != "screen-share-stop") return

        val signal = JSONObject()
            .put("kind", kind)
            .put("callId", callId)
            .put("callType", "screen")
            .put("signalId", "native-" + UUID.randomUUID().toString())

        if (description != null) {
            signal.put(
                "description",
                JSONObject()
                    .put("type", description.type.canonicalForm())
                    .put("sdp", description.description)
            )
        }

        if (candidate != null) {
            signal.put(
                "candidate",
                JSONObject()
                    .put("candidate", candidate.sdp)
                    .put("sdpMid", candidate.sdpMid ?: "")
                    .put("sdpMLineIndex", candidate.sdpMLineIndex)
            )
        }

        if (webSocketReady) {
            val wsPayload = JSONObject()
                .put("type", "call.signal")
                .put("targetUserId", peerId)
                .put("signal", signal)
            webSocket?.send(wsPayload.toString())
        }

        postSignalHttp(signal)
    }

    private fun postSignalHttp(signal: JSONObject) {
        try {
            val payload = JSONObject()
                .put("targetUserId", peerId)
                .put("signal", signal)
                .toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType())

            val request = Request.Builder()
                .url(API_BASE + "/api/realtime/signals")
                .header("Authorization", "Bearer " + token)
                .post(payload)
                .build()

            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful && !webSocketReady && !stopping.get()) {
                    onError("A sinalização da transmissão respondeu HTTP " + response.code + ".")
                }
            }
        } catch (error: Exception) {
            if (!webSocketReady && !stopping.get()) {
                onError(error.message ?: "A sinalização da transmissão ficou indisponível.")
            }
        }
    }

    private fun fetchIceServers(): List<PeerConnection.IceServer> {
        val fallback = listOf(
            PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )

        return try {
            val request = Request.Builder()
                .url(API_BASE + "/api/realtime/ice-servers")
                .header("Authorization", "Bearer " + token)
                .get()
                .build()

            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return fallback
                val root = JSONObject(response.body?.string().orEmpty())
                val rawServers = root.optJSONArray("iceServers") ?: return fallback
                val result = mutableListOf<PeerConnection.IceServer>()

                for (i in 0 until rawServers.length()) {
                    val server = rawServers.optJSONObject(i) ?: continue
                    val username = server.optString("username")
                    val credential = server.optString("credential")
                    val urls = mutableListOf<String>()

                    when (val rawUrls = server.opt("urls")) {
                        is String -> if (rawUrls.isNotBlank()) urls += rawUrls
                        is JSONArray -> for (j in 0 until rawUrls.length()) {
                            rawUrls.optString(j).takeIf { it.isNotBlank() }?.let(urls::add)
                        }
                    }

                    for (url in urls) {
                        val builder = PeerConnection.IceServer.builder(url)
                        if (username.isNotBlank()) builder.setUsername(username)
                        if (credential.isNotBlank()) builder.setPassword(credential)
                        result += builder.createIceServer()
                    }
                }

                if (result.isEmpty()) fallback else result
            }
        } catch (_: Exception) {
            fallback
        }
    }

    private fun safePollSignals() {
        if (stopping.get()) return
        pollTick += 1
        if (webSocketReady && pollTick % 4 != 0) return

        try {
            val request = Request.Builder()
                .url(API_BASE + "/api/realtime/signals?since=" + signalCursor)
                .header("Authorization", "Bearer " + token)
                .get()
                .build()

            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return
                val root = JSONObject(response.body?.string().orEmpty())
                signalCursor = max(signalCursor, root.optLong("serverTime", System.currentTimeMillis()))
                val signals = root.optJSONArray("signals") ?: return

                for (i in 0 until signals.length()) {
                    val event = signals.optJSONObject(i) ?: continue
                    if (event.optString("fromUserId") != peerId) continue
                    handleSignal(event.optJSONObject("signal"))
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun handleSignal(signal: JSONObject?) {
        if (signal == null || signal.optString("callId") != callId) return
        val signalId = signal.optString("signalId")

        if (signalId.isNotBlank()) {
            if (!seenSignalIds.add(signalId)) return
            while (seenSignalIds.size > 300) {
                val first = seenSignalIds.firstOrNull() ?: break
                seenSignalIds.remove(first)
            }
        }

        when (signal.optString("kind")) {
            "native-screen-answer" -> {
                val description = signal.optJSONObject("description") ?: return
                val sdp = description.optString("sdp")
                if (sdp.isBlank()) return
                val pc = peerConnection ?: return
                pc.setRemoteDescription(
                    object : SimpleSdpObserver() {
                        override fun onSetSuccess() {
                            executor.execute {
                                remoteDescriptionReady = true
                                val queued = pendingRemoteIce.toList()
                                pendingRemoteIce.clear()
                                for (candidate in queued) {
                                    try { pc.addIceCandidate(candidate) } catch (_: Exception) {}
                                }
                            }
                        }

                        override fun onSetFailure(error: String) {
                            fail("A resposta da transmissão foi rejeitada: " + error)
                        }
                    },
                    SessionDescription(SessionDescription.Type.ANSWER, sdp)
                )
            }

            "native-screen-ice" -> {
                val raw = signal.optJSONObject("candidate") ?: return
                val sdp = raw.optString("candidate")
                if (sdp.isBlank()) return
                val candidate = IceCandidate(
                    raw.optString("sdpMid", ""),
                    raw.optInt("sdpMLineIndex", 0),
                    sdp
                )
                val pc = peerConnection ?: return
                if (!remoteDescriptionReady || pc.remoteDescription == null) {
                    pendingRemoteIce += candidate
                    return
                }
                try { pc.addIceCandidate(candidate) } catch (_: Exception) {
                    pendingRemoteIce += candidate
                }
            }

            "hangup", "native-screen-stop", "screen-share-stop" -> stop("remote-stop")
        }
    }

    fun stop(reason: String) {
        if (!stopping.compareAndSet(false, true)) return

        executor.execute {
            try {
                sendSignal("native-screen-stop")
                sendSignal("screen-share-stop")
            } catch (_: Exception) {
            } finally {
                cleanup()
                onState(false)
                onStopped()
            }
        }
    }

    fun forceClose() {
        if (!stopping.compareAndSet(false, true)) return
        try {
            cleanup()
            onState(false)
        } catch (_: Exception) {
        }
    }

    private fun fail(message: String) {
        if (stopping.get()) return
        onError(message)
        stop("error")
    }

    private fun cleanup() {
        webSocketReady = false
        try { webSocket?.close(1000, "screen share ended") } catch (_: Exception) {}
        webSocket = null

        try { capturer?.stopCapture() } catch (_: Exception) {}
        try { capturer?.dispose() } catch (_: Exception) {}
        capturer = null

        try { videoTrack?.dispose() } catch (_: Exception) {}
        videoTrack = null
        try { videoSource?.dispose() } catch (_: Exception) {}
        videoSource = null
        try { surfaceTextureHelper?.dispose() } catch (_: Exception) {}
        surfaceTextureHelper = null

        pendingRemoteIce.clear()
        remoteDescriptionReady = false
        try { peerConnection?.close() } catch (_: Exception) {}
        try { peerConnection?.dispose() } catch (_: Exception) {}
        peerConnection = null

        try { factory?.dispose() } catch (_: Exception) {}
        factory = null
        try { egl?.release() } catch (_: Exception) {}
        egl = null

        try { http.dispatcher.executorService.shutdown() } catch (_: Exception) {}
        try { http.connectionPool.evictAll() } catch (_: Exception) {}
        executor.shutdown()
    }

    private open class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String) = Unit
        override fun onSetFailure(error: String) = Unit
    }
}
