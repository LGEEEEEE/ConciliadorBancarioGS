// script.js (VERSÃO COM FEEDBACK DE SUCESSO)

// Garante que o worker do PDF.js seja encontrado
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;

// =================================================================================
// SELEÇÃO DOS ELEMENTOS DO DOM
// =================================================================================
const estoquenowFileInput = document.getElementById('estoquenowFile');
const extratosFilesInput = document.getElementById('extratosFiles');
const btnAnalisar = document.getElementById('btnAnalisar');
const loader = document.getElementById('loader');

const resultadoDiv = document.getElementById('resultado');
const resumoDiv = document.getElementById('resumo');

// Elementos da nova tabela de sucesso
const encontradasWrapper = document.getElementById('encontradasWrapper');
const tabelaEncontradasBody = document.querySelector('#tabelaEncontradas tbody');

const naoEncontradasWrapper = document.getElementById('naoEncontradasWrapper');
const tabelaNaoEncontradasBody = document.querySelector('#tabelaNaoEncontradas tbody');
const naoIdentificadosWrapper = document.getElementById('naoIdentificadosWrapper');
const tabelaNaoIdentificadosBody = document.querySelector('#tabelaNaoIdentificados tbody');


// =================================================================================
// REGRAS DE NEGÓCIO E CONFIGURAÇÕES
// =================================================================================
const mapaBancos = {
    'PIX': ['bb'], 'DINHEIRO': ['caixa'], 'DEBITO': ['pagbank', 'itau'],
    'CRÉDITO': ['pagbank', 'itau'], 'CARTÃO DE CRÉDITO': ['pagbank', 'itau'],
    'PIX QR CODE': ['pagbank', 'itau'], 'LINK 2X': ['pagbank', 'itau'], 'PIX CNPJ': ['santander']
};

// =================================================================================
// FUNÇÕES DE PROCESSAMENTO DE ARQUIVOS
// =================================================================================
async function processarEstoqueNowPDF(file) {
    const typedarray = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    let textoCompleto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        textoCompleto += textContent.items.map(item => item.str).join(' ');
    }
    const regexTransacoes = /Recibo\s+\d{8}\s+(.*?)\s+(?:[\d./-]{14,18})\s+\d{2}\/\d{2}\/\d{4}\s+(.*?)\s+Pago\s+R\$\s+([\d.,]+)/g;
    const vendas = [];
    let match;
    while ((match = regexTransacoes.exec(textoCompleto)) !== null) {
        try {
            const cliente = match[1].trim();
            const forma_pgto = match[2].trim().toUpperCase().replace(/\s+/g, ' ');
            const valor = parseBrazilianNumber(match[3]);
            vendas.push({ cliente, forma_pgto, valor });
        } catch (e) { console.warn("Ignorando correspondência de transação malformada:", match[0]); }
    }
    if (vendas.length === 0) {
        console.error("Texto extraído do PDF que falhou na análise:", textoCompleto);
        throw new Error("Nenhuma transação válida foi encontrada no PDF. O formato pode ter mudado. O texto extraído foi enviado para o console do navegador (F12).");
    }
    return vendas;
}

function processarEstoqueNowCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: (results) => {
                try {
                    const vendas = results.data.map(linha => {
                        const cliente = linha.CLIENTE || linha.Cliente;
                        const forma_pgto = (linha['FORMA DE PGTO'] || linha['Forma de Pgto'] || '').trim().toUpperCase();
                        const valorBruto = (linha['VALOR BRUTO'] || linha['Valor Bruto'] || '0');
                        const valor = parseBrazilianNumber(valorBruto);
                        if (!cliente || !forma_pgto) return null;
                        return { cliente, forma_pgto, valor };
                    }).filter(v => v !== null);
                    resolve(vendas);
                } catch (e) { reject(new Error("Erro ao ler as colunas do CSV do EstoqueNOW.")); }
            },
            error: (err) => reject(err)
        });
    });
}

async function processarExtratoPagBankPDF(file) { /* ...código sem alterações... */ }
async function processarExtratoItauPDF(file) { /* ...código sem alterações... */ }

function parseBrazilianNumber(numberString) {
    if (typeof numberString !== 'string') { return parseFloat(numberString) || 0; }
    let cleanString = numberString.replace(/[^0-9,.-]+/g,"");
    cleanString = cleanString.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleanString) || 0;
}

function processarExtratoCSV(file) {
     return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim(), 
            complete: (results) => {
                try {
                    const transacoes = results.data.map(linha => {
                        const descricao = linha.histórico || linha.descricao || linha.lançamento || '';
                        const valorStr = String(linha.valor || linha.crédito || '0');
                        const valor = parseBrazilianNumber(valorStr);
                        return { descricao, valor };
                    }).filter(t => t.valor > 0 && !isNaN(t.valor));
                    resolve(transacoes);
                } catch (e) { reject(new Error(`Erro ao ler o extrato ${file.name}. Verifique as colunas.`)); }
            },
            error: (err) => reject(err)
        });
    });
}

async function processarExtratos(files) {
    const extratosPorBanco = {};
    for (const file of files) {
        if (!file || !file.name) { console.warn("Um arquivo inválido foi ignorado."); continue; }
        let prefixo = 'desconhecido';
        const nomeArquivo = file.name.toLowerCase();
        if (nomeArquivo.includes('pagbank')) { prefixo = 'pagbank';
        } else if (nomeArquivo.includes('movimentacoes') || nomeArquivo.startsWith('bb')) { prefixo = 'bb';
        } else if (nomeArquivo.includes('itau')) { prefixo = 'itau'; }
        let transacoes = [];
        if (file.type === "application/pdf" && prefixo === 'pagbank') { transacoes = await processarExtratoPagBankPDF(file);
        } else if (file.type === "application/pdf" && prefixo === 'itau') { transacoes = await processarExtratoItauPDF(file);
        } else if (file.type === "text/csv") { transacoes = await processarExtratoCSV(file);
        } else { console.warn(`Arquivo ${file.name} ignorado.`); continue; }
        if (!extratosPorBanco[prefixo]) extratosPorBanco[prefixo] = [];
        extratosPorBanco[prefixo].push(...transacoes);
    }
    return extratosPorBanco;
}


// =================================================================================
// NÚCLEO DA LÓGICA DE CONCILIAÇÃO
// =================================================================================
// ***** ATUALIZADO PARA RETORNAR A LISTA DE VENDAS ENCONTRADAS *****
function realizarConciliacao(vendas, extratos) {
    const vendasNaoEncontradas = [];
    const vendasEncontradas = []; // <-- Nova lista
    
    for(const banco in extratos) { extratos[banco].forEach(t => t.usada = false); }

    vendas.forEach(venda => {
        const formaPgtoNormalizada = venda.forma_pgto.toUpperCase().trim();
        const prefixosParaProcurar = mapaBancos[formaPgtoNormalizada];
        let encontrada = false;

        if (prefixosParaProcurar) {
            for (const prefixo of prefixosParaProcurar) {
                if (extratos[prefixo]) {
                    const extratoCorreto = extratos[prefixo];
                    const indiceMatch = extratoCorreto.findIndex(t => Math.abs(t.valor - venda.valor) < 0.01 && !t.usada);
                    if (indiceMatch !== -1) {
                        extratoCorreto[indiceMatch].usada = true;
                        // Adiciona a venda à lista de sucesso com o banco onde foi encontrada
                        vendasEncontradas.push({ ...venda, bancoEncontrado: prefixo });
                        encontrada = true;
                        break;
                    }
                }
            }
        }
        if (!encontrada) { vendasNaoEncontradas.push(venda); }
    });

    const creditosNaoIdentificados = [];
    for(const banco in extratos) {
        extratos[banco].forEach(t => {
            if (!t.usada) { creditosNaoIdentificados.push({ banco, ...t }); }
        });
    }

    return { vendasNaoEncontradas, vendasEncontradas, creditosNaoIdentificados, totalVendas: vendas.length };
}


// =================================================================================
// FUNÇÕES DE RENDERIZAÇÃO E EVENTOS
// =================================================================================
// ***** ATUALIZADO PARA EXIBIR A NOVA TABELA DE SUCESSO *****
function exibirResultados(resultados) {
    tabelaEncontradasBody.innerHTML = '';
    tabelaNaoEncontradasBody.innerHTML = '';
    tabelaNaoIdentificadosBody.innerHTML = '';
    
    const { vendasNaoEncontradas, vendasEncontradas, creditosNaoIdentificados, totalVendas } = resultados;
    const totalConciliado = totalVendas - vendasNaoEncontradas.length;

    if (vendasNaoEncontradas.length === 0 && totalVendas > 0) {
        resumoDiv.className = 'resumo sucesso';
        resumoDiv.textContent = `✅ SUCESSO! Todas as ${totalVendas} vendas foram conciliadas.`;
    } else if (totalVendas > 0) {
        resumoDiv.className = 'resumo aviso';
        resumoDiv.textContent = `⚠️ ATENÇÃO! ${totalConciliado} de ${totalVendas} vendas foram conciliadas.`;
    } else {
         resumoDiv.className = 'resumo aviso';
         resumoDiv.textContent = 'Nenhuma venda encontrada no relatório para conciliar.';
    }
    
    // Popula a nova tabela de vendas encontradas
    if (vendasEncontradas.length > 0) {
        vendasEncontradas.forEach(venda => {
            const linha = tabelaEncontradasBody.insertRow();
            linha.innerHTML = `
                <td>${venda.cliente}</td>
                <td>${venda.forma_pgto}</td>
                <td>${venda.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td><b>${venda.bancoEncontrado.toUpperCase()}</b></td>
            `;
        });
        encontradasWrapper.classList.remove('hidden');
    } else {
        encontradasWrapper.classList.add('hidden');
    }

    // Popula a tabela de vendas não encontradas
    if (vendasNaoEncontradas.length > 0) {
        vendasNaoEncontradas.forEach(venda => {
            const linha = tabelaNaoEncontradasBody.insertRow();
            const bancosProcurados = mapaBancos[venda.forma_pgto.toUpperCase().trim()]?.map(b => b.toUpperCase()).join(' ou ') || 'N/A';
            linha.innerHTML = `
                <td>${venda.cliente}</td>
                <td>${venda.forma_pgto}</td>
                <td>${venda.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td><b>${bancosProcurados}</b></td>
            `;
        });
        naoEncontradasWrapper.classList.remove('hidden');
    } else {
        naoEncontradasWrapper.classList.add('hidden');
    }
    
    // Popula a tabela de créditos não identificados
    if (creditosNaoIdentificados.length > 0) {
        creditosNaoIdentificados.forEach(credito => {
            const linha = tabelaNaoIdentificadosBody.insertRow();
            linha.innerHTML = `
                <td><b>${credito.banco.toUpperCase()}</b></td>
                <td>${credito.descricao}</td>
                <td>${credito.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            `;
        });
        naoIdentificadosWrapper.classList.remove('hidden');
    } else {
        naoIdentificadosWrapper.classList.add('hidden');
    }

    resultadoDiv.classList.remove('hidden');
}

function habilitarBotao() {
    if (estoquenowFileInput.files.length > 0 && extratosFilesInput.files.length > 0) {
        btnAnalisar.disabled = false;
    } else {
        btnAnalisar.disabled = true;
    }
}

async function handleAnalisar() {
    btnAnalisar.disabled = true;
    loader.classList.remove('hidden');
    resultadoDiv.classList.add('hidden');

    try {
        const estoqueFile = estoquenowFileInput.files[0];
        let vendas;
        if (estoqueFile.name.toLowerCase().endsWith('.pdf')) {
            vendas = await processarEstoqueNowPDF(estoqueFile);
        } else if (estoqueFile.name.toLowerCase().endsWith('.csv')) {
            vendas = await processarEstoqueNowCSV(estoqueFile);
        } else {
            throw new Error("Formato de arquivo do EstoqueNOW não suportado. Use PDF ou CSV.");
        }
        
        const extratos = await processarExtratos(extratosFilesInput.files);
        const resultados = realizarConciliacao(vendas, extratos);
        exibirResultados(resultados);

    } catch (error) {
        alert(`Ocorreu um erro: ${error.message}`);
        resultadoDiv.classList.add('hidden');
    } finally {
        loader.classList.add('hidden');
        habilitarBotao();
    }
}

// Adiciona os gatilhos de eventos
estoquenowFileInput.addEventListener('change', habilitarBotao);
extratosFilesInput.addEventListener('change', habilitarBotao);
btnAnalisar.addEventListener('click', handleAnalisar);