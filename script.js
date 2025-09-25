// script.js (VERSÃO FINAL E ROBUSTA)

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

const naoEncontradasWrapper = document.getElementById('naoEncontradasWrapper');
const tabelaNaoEncontradasBody = document.querySelector('#tabelaNaoEncontradas tbody');
const naoIdentificadosWrapper = document.getElementById('naoIdentificadosWrapper');
const tabelaNaoIdentificadosBody = document.querySelector('#tabelaNaoIdentificados tbody');


// =================================================================================
// REGRAS DE NEGÓCIO E CONFIGURAÇÕES
// =================================================================================
const mapaBancos = {
    'PIX': ['bb'],
    'DINHEIRO': ['caixa'],
    'CARTÃO DE CRÉDITO': ['pagbank', 'itau'],
    'DÉBITO': ['pagbank', 'itau'],
    'PIX QRCODE': ['pagbank', 'itau'],
    'PIX CNPJ': ['santander']
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

    const blocosDeTransacao = textoCompleto.split(/Recibo\s+\d{8}/);
    if (blocosDeTransacao.length <= 1) {
        console.error("Texto extraído do PDF do EstoqueNOW:", textoCompleto);
        throw new Error("Padrão 'Recibo' não encontrado no PDF do EstoqueNOW. Para ajudar no diagnóstico, o texto extraído do PDF foi enviado para o console do navegador (aperte F12 para ver).");
    }

    const vendas = [];
    for (let i = 1; i < blocosDeTransacao.length; i++) {
        const bloco = blocosDeTransacao[i];
        try {
            const matchCliente = bloco.match(/^\s*(.*?)\s+\d{3}\.\d{3}\.\d{3}-\d{2}/);
            const matchFormaPgto = bloco.match(/(PIX|DINHEIRO|CARTÃO DE CRÉDITO|DÉBITO|PIX QRCODE|PIX CNPJ)/i);
            const matchValor = bloco.match(/R\$\s+([\d.,]+)/);

            if (matchCliente && matchFormaPgto && matchValor) {
                const cliente = matchCliente[1].trim();
                const forma_pgto = matchFormaPgto[0].trim().toUpperCase();
                const valor = parseFloat(matchValor[1].replace(/\./g, '').replace(',', '.'));
                vendas.push({ cliente, forma_pgto, valor });
            }
        } catch (e) {
            console.warn("Não foi possível analisar o seguinte bloco de texto do EstoqueNOW:", bloco);
        }
    }

    if (vendas.length === 0) {
        console.error("Texto extraído do PDF do EstoqueNOW que falhou na análise:", textoCompleto);
        throw new Error("Nenhuma transação válida foi encontrada no PDF do EstoqueNOW. Para ajudar no diagnóstico, o texto completo extraído foi enviado para o console do navegador (aperte F12 para ver).");
    }
    return vendas;
}

function processarEstoqueNowCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const vendas = results.data.map(linha => {
                        const cliente = linha.CLIENTE || linha.Cliente;
                        const forma_pgto = (linha['FORMA DE PGTO'] || linha['Forma de Pgto'] || '').trim().toUpperCase();
                        const valorBruto = (linha['VALOR BRUTO'] || linha['Valor Bruto'] || '0');
                        const valor = parseFloat(valorBruto.replace(/[^0-9,.-]+/g,"").replace('.', '').replace(',', '.'));
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

async function processarExtratoPagBankPDF(file) {
    const typedarray = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    let textoCompleto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        textoCompleto += textContent.items.map(item => item.str).join(' ');
    }
    const regexTransacoes = /(?:Venda|QR Code Pix)\s(.*?)\s([\d,.-]+)/g;
    const transacoes = [];
    let match;
    while ((match = regexTransacoes.exec(textoCompleto)) !== null) {
        const valor = parseFloat(match[2].replace(/\./g, '').replace(',', '.'));
        if (valor > 0) {
            transacoes.push({
                descricao: match[1].trim(),
                valor: valor
            });
        }
    }
    return transacoes;
}

async function processarExtratoItauPDF(file) {
    const typedarray = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument(typedarray).promise;
    let textoCompleto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        textoCompleto += textContent.items.map(item => item.str).join(' ');
    }
    const regexTransacoes = /Venda\s(crédito|débito|pix).*?R\$\s([\d.,]+)/gi;
    const transacoes = [];
    let match;
    while ((match = regexTransacoes.exec(textoCompleto)) !== null) {
        const valor = parseFloat(match[2].replace(/\./g, '').replace(',', '.'));
        if (valor > 0) {
            transacoes.push({
                descricao: `Venda ${match[1]}`,
                valor: valor
            });
        }
    }
    return transacoes;
}


// ***** FUNÇÃO ATUALIZADA PARA SER MAIS ROBUSTA *****
function processarExtratoCSV(file) {
     return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                try {
                    const transacoes = results.data
                        .map(linha => {
                            // Procura por variações comuns nos nomes das colunas
                            const descricao = linha.Histórico || linha.Descricao || linha.Lançamento || '';
                            const valorStr = (linha.Valor || linha.valor || linha.Crédito || '0');
                            
                            // Lógica aprimorada para converter o número, aceitando tanto "1.500,50" quanto "1500.50"
                            const valorLimpo = valorStr.replace(/\./g, '').replace(',', '.');
                            const valor = parseFloat(valorLimpo);
                            
                            return { descricao, valor };
                        })
                        .filter(t => t.valor > 0 && !isNaN(t.valor)); // Apenas créditos válidos
                    resolve(transacoes);
                } catch (e) {
                     reject(new Error(`Erro ao ler o extrato ${file.name}. Verifique as colunas.`));
                }
            },
            error: (err) => reject(err)
        });
    });
}


async function processarExtratos(files) {
    const extratosPorBanco = {};
    for (const file of files) {
        let prefixo = 'desconhecido';
        const nomeArquivo = file.name.toLowerCase();
        
        if (nomeArquivo.includes('pagbank')) {
            prefixo = 'pagbank';
        } else if (nomeArquivo.includes('movimentacoes') || nomeArquivo.startsWith('bb')) {
            prefixo = 'bb';
        } else if (nomeArquivo.includes('itau')) {
            prefixo = 'itau';
        }
        
        let transacoes = [];
        if (file.type === "application/pdf" && prefixo === 'pagbank') {
            transacoes = await processarExtratoPagBankPDF(file);
        } else if (file.type === "application/pdf" && prefixo === 'itau') {
            transacoes = await processarExtratoItauPDF(file);
        } else if (file.type === "text/csv") {
            transacoes = await processarExtratoCSV(file);
        } else {
            console.warn(`Arquivo ${file.name} ignorado. Formato não suportado ou prefixo de banco não reconhecido.`);
            continue;
        }
        
        if (!extratosPorBanco[prefixo]) extratosPorBanco[prefixo] = [];
        extratosPorBanco[prefixo].push(...transacoes);
    }
    return extratosPorBanco;
}


// =================================================================================
// NÚCLEO DA LÓGICA DE CONCILIAÇÃO
// =================================================================================
function realizarConciliacao(vendas, extratos) {
    const vendasNaoEncontradas = [];
    
    for(const banco in extratos) {
        extratos[banco].forEach(t => t.usada = false);
    }

    vendas.forEach(venda => {
        const formaPgtoNormalizada = venda.forma_pgto.toUpperCase().trim();
        const prefixosParaProcurar = mapaBancos[formaPgtoNormalizada];
        let encontrada = false;

        if (prefixosParaProcurar) {
            for (const prefixo of prefixosParaProcurar) {
                if (extratos[prefixo]) {
                    const extratoCorreto = extratos[prefixo];
                    const indiceMatch = extratoCorreto.findIndex(t => t.valor === venda.valor && !t.usada);
                    
                    if (indiceMatch !== -1) {
                        extratoCorreto[indiceMatch].usada = true;
                        encontrada = true;
                        break;
                    }
                }
            }
        }
        
        if (!encontrada) {
            vendasNaoEncontradas.push(venda);
        }
    });

    const creditosNaoIdentificados = [];
    for(const banco in extratos) {
        extratos[banco].forEach(t => {
            if (!t.usada) {
                creditosNaoIdentificados.push({ banco, ...t });
            }
        });
    }

    return { vendasNaoEncontradas, creditosNaoIdentificados, totalVendas: vendas.length };
}


// =================================================================================
// FUNÇÕES DE RENDERIZAÇÃO E EVENTOS
// =================================================================================
function exibirResultados(resultados) {
    tabelaNaoEncontradasBody.innerHTML = '';
    tabelaNaoIdentificadosBody.innerHTML = '';
    
    const { vendasNaoEncontradas, creditosNaoIdentificados, totalVendas } = resultados;
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