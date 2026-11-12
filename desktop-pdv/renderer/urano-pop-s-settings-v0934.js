/* ThorPDV 0.9.34: Urano POP-S controls in the active settings modal. */
(function () {
  'use strict';
  const PANEL_ID = 'urano-pop-s-settings-v0934';
  const VALID_COM = /^COM[1-9][0-9]{0,2}$/i;
  let queued = false;

  function mount(modal) {
    if (modal.querySelector('#' + PANEL_ID)) return;
    const grid = modal.querySelector('.v3-settings-grid') || modal.querySelector('.settings-grid');
    if (!grid || !modal.querySelector('#saveSettings')) return;

    const section = document.createElement('section');
    section.id = PANEL_ID;
    section.innerHTML =
      '<h4>Balança Urano POP-S — Bluetooth / COM</h4>' +
      '<p class="muted">Pareie a balança com o Windows via Bluetooth SPP e informe a porta COM de saída criada pelo sistema. O teste consulta o equipamento com o comando 04 (hexadecimal).</p>' +
      '<div class="field"><label for="uranoModelV34">Modelo de balança</label>' +
      '<select id="uranoModelV34"><option value="generic">Balança serial padrão</option><option value="urano-pop-s">Urano POP-S (Bluetooth / COM)</option></select></div>' +
      '<div class="field"><label for="uranoPortV34">Porta COM da balança</label>' +
      '<input id="uranoPortV34" placeholder="Ex.: COM5" list="uranoPortsV34" autocomplete="off"><datalist id="uranoPortsV34"></datalist></div>' +
      '<div class="field"><label for="uranoBaudV34">Velocidade de comunicação</label>' +
      '<select id="uranoBaudV34"><option value="1200">1200 bps</option><option value="2400">2400 bps</option><option value="4800">4800 bps</option><option value="9600">9600 bps</option><option value="19200">19200 bps</option></select></div>' +
      '<p class="muted">Para POP-S, confira o protocolo selecionado no equipamento (Prot 1, conforme a configuração da balança). O peso só será aplicado à venda quando a resposta for reconhecida.</p>' +
      '<div class="actions"><button class="secondary" type="button" id="uranoTestV34">Testar leitura da POP-S</button>' +
      '<button class="primary" type="button" id="uranoSaveV34">Salvar conexão da balança</button></div>' +
      '<div id="uranoResultV34" class="hardware-result" role="status" aria-live="polite" style="overflow-wrap:anywhere"></div>';
    grid.appendChild(section);

    const field = (id) => section.querySelector('#' + id);
    const output = field('uranoResultV34');
    const model = field('uranoModelV34');
    const port = field('uranoPortV34');
    const baud = field('uranoBaudV34');
    const save = field('uranoSaveV34');
    const test = field('uranoTestV34');

    function syncNativeFields() {
      const selectedPort = port.value.trim().toUpperCase();
      const nativePort = modal.querySelector('#scalePort');
      const nativeBaud = modal.querySelector('#scaleBaud');
      if (nativePort && selectedPort) {
        if (![...nativePort.options].some((o) => o.value.toUpperCase() === selectedPort)) {
          nativePort.add(new Option(selectedPort + ' — Bluetooth / COM', selectedPort));
        }
        nativePort.value = selectedPort;
      }
      if (nativeBaud && [...nativeBaud.options].some((o) => o.value === baud.value)) {
        nativeBaud.value = baud.value;
      }
    }

    function config() {
      return {
        scaleProtocol: model.value,
        scalePort: port.value.trim().toUpperCase(),
        scaleBaud: Number(baud.value)
      };
    }

    function valid() {
      if (model.value === 'urano-pop-s' && !VALID_COM.test(port.value.trim())) {
        output.textContent = 'Informe uma porta COM válida, por exemplo COM5.';
        return false;
      }
      return true;
    }

    async function persist() {
      if (!valid()) return false;
      syncNativeFields();
      await window.thor.saveV3Settings(config());
      return true;
    }

    Promise.all([
      window.thor.v3Settings().catch(() => ({})),
      window.thor.serialPorts().catch(() => [])
    ]).then(([settings, ports]) => {
      if (!section.isConnected) return;
      model.value = settings.scaleProtocol === 'urano-pop-s' ? 'urano-pop-s' : 'generic';
      port.value = String(settings.scalePort || '').toUpperCase();
      baud.value = String([1200, 2400, 4800, 9600, 19200].includes(Number(settings.scaleBaud)) ? Number(settings.scaleBaud) : 9600);
      const list = field('uranoPortsV34');
      (Array.isArray(ports) ? ports : []).forEach((item) => {
        const device = String(item.DeviceID || item.port || '').trim();
        if (!VALID_COM.test(device)) return;
        const option = document.createElement('option');
        option.value = device.toUpperCase();
        option.label = String(item.Name || item.Description || 'Porta serial');
        list.appendChild(option);
      });
    }).catch((error) => {
      output.textContent = 'Não foi possível carregar as portas COM: ' + String(error.message || error);
    });

    save.onclick = async () => {
      save.disabled = true;
      output.textContent = 'Salvando configuração...';
      try {
        if (await persist()) output.textContent = 'Configuração da balança salva neste terminal.';
      } catch (error) {
        output.textContent = 'Falha ao salvar: ' + String(error.message || error);
      } finally {
        save.disabled = false;
      }
    };

    test.onclick = async () => {
      if (!VALID_COM.test(port.value.trim())) {
        output.textContent = 'Selecione uma porta COM de saída Bluetooth válida.';
        return;
      }
      test.disabled = true;
      output.textContent = 'Salvando COM e testando a Urano POP-S...';
      try {
        model.value = 'urano-pop-s';
        await persist();
        const reading = await window.thor.readUranoPopS({
          port: port.value.trim().toUpperCase(),
          baudRate: Number(baud.value),
          timeoutMs: 3500
        });
        if (Number.isFinite(reading.weightKg) && reading.weightKg > 0) {
          output.textContent = 'Peso recebido: ' + reading.weightKg.toFixed(3) + ' kg. Confira com o visor antes de vender.';
        } else {
          output.textContent = 'Comunicação recebida, mas protocolo de peso não confirmado. HEX: ' +
            String(reading.rawHex || '(vazio)') + '; texto: ' + String(reading.rawText || '(vazio)') +
            '. Informe estes dados para ajustarmos o decodificador.';
        }
      } catch (error) {
        output.textContent = 'Falha na leitura: ' + String(error.message || error);
      } finally {
        test.disabled = false;
      }
    };

    const mainSave = modal.querySelector('#saveSettings');
    mainSave.addEventListener('click', () => {
      if (valid()) {
        syncNativeFields();
        window.thor.saveV3Settings({ scaleProtocol: model.value }).catch(() => {});
      }
    }, true);

    port.addEventListener('change', syncNativeFields);
    baud.addEventListener('change', syncNativeFields);
  }

  function scan() {
    queued = false;
    document.querySelectorAll('.modal').forEach(mount);
  }
  const observer = new MutationObserver(() => {
    if (!queued) {
      queued = true;
      queueMicrotask(scan);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
})();
